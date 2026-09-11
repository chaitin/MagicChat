import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioStream,
  type AudioStreamBuffer,
  type RecordingOptions,
} from "expo-audio"
import { File } from "expo-file-system"
import { useCallback, useEffect, useRef, useState } from "react"
import { Platform } from "react-native"

import type { PreparedClientVoiceMessage } from "@/data/messages/message-upload"
import {
  decodeFloat32Mono,
  PCM16StreamEncoder,
} from "@/domain/audio/pcm-audio"
import { getVoiceRecordingFormat } from "@/domain/audio/voice-recording-format"
import { stopActiveVoicePlayback } from "@/features/conversation/voice/voice-message-player-state"
import {
  ASRRealtimeClient,
  buildASRWebSocketUrl,
} from "@/realtime/asr-realtime-client"

export const VOICE_MESSAGE_MAX_BYTES = 1 * 1024 * 1024
export const VOICE_MESSAGE_MAX_DURATION_MS = 60_000

const VOICE_MESSAGE_MIN_DURATION_MS = 500
const ASR_CONNECT_TIMEOUT_MS = 10_000
const ASR_COMPLETION_TIMEOUT_MS = 15_000

const VOICE_RECORDING_FORMAT = getVoiceRecordingFormat(Platform.OS)

const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  android: {
    audioEncoder: "aac",
    audioSource: "voice_communication",
    maxFileSize: VOICE_MESSAGE_MAX_BYTES,
    outputFormat: "mpeg4",
  },
  bitRate: Platform.OS === "ios" ? 64_000 : 24_000,
  directory: "cache",
  extension: VOICE_RECORDING_FORMAT.extension,
  ios: {
    audioQuality: AudioQuality.MEDIUM,
    outputFormat: IOSOutputFormat.MPEG4AAC,
  },
  isMeteringEnabled: true,
  numberOfChannels: 1,
  sampleRate: Platform.OS === "ios" ? 44_100 : 48_000,
  web: {
    bitsPerSecond: 24_000,
    mimeType: "audio/webm;codecs=opus",
  },
}

export type VoiceMessageRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "transcribing"
  | "recorded"

export function useVoiceMessageRecorder({
  onTranscript,
  serverUrl,
}: {
  onTranscript?: (text: string) => void
  serverUrl: string
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS)
  const recorderState = useAudioRecorderState(recorder, 100)
  const mountedRef = useRef(true)
  const operationVersionRef = useRef(0)
  const recorderPreparationRef = useRef<Promise<boolean> | null>(null)
  const startedAtRef = useRef(0)
  const statusRef = useRef<VoiceMessageRecorderStatus>("idle")
  const stopRequestedRef = useRef(false)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingRef = useRef<PreparedClientVoiceMessage | null>(null)
  const pendingRecordingRef = useRef<PreparedClientVoiceMessage | null>(null)
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const onTranscriptRef = useRef(onTranscript)
  const asrClientRef = useRef<ASRRealtimeClient | null>(null)
  const asrConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const asrCompletionTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)
  const asrPendingRef = useRef(false)
  const asrReadyRef = useRef(false)
  const asrCommitRequestedRef = useRef(false)
  const pcmEncoderRef = useRef<PCM16StreamEncoder | null>(null)
  const pcmSourceSampleRateRef = useRef(0)
  const pendingPCMFramesRef = useRef<ArrayBuffer[]>([])
  const [completedDurationMS, setCompletedDurationMS] = useState(0)
  const [error, setError] = useState("")
  const [recording, setRecording] =
    useState<PreparedClientVoiceMessage | null>(null)
  const [status, setStatusState] =
    useState<VoiceMessageRecorderStatus>("idle")
  const [transcriptionError, setTranscriptionError] = useState("")
  const { stream: audioStream } = useAudioStream({
    channels: 1,
    encoding: "float32",
    onBuffer: handleAudioBuffer,
    sampleRate: 48_000,
  })

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const setStatus = useCallback((nextStatus: VoiceMessageRecorderStatus) => {
    statusRef.current = nextStatus
    if (mountedRef.current) setStatusState(nextStatus)
  }, [])

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current !== null) {
      clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
  }, [])

  const releaseRecordingMode = useCallback(async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      })
    } catch {
      // The recorder has already released the microphone. Audio mode reset is
      // best-effort so a platform interruption does not discard valid audio.
    }
  }, [])

  const stopAudioStream = useCallback(() => {
    try {
      audioStream.stop()
    } catch {
      // Starting the optional PCM stream can fail on devices that do not allow
      // concurrent microphone clients. Voice file recording remains usable.
    }
  }, [audioStream])

  const clearASRTimers = useCallback(() => {
    if (asrConnectTimerRef.current !== null) {
      clearTimeout(asrConnectTimerRef.current)
      asrConnectTimerRef.current = null
    }
    if (asrCompletionTimerRef.current !== null) {
      clearTimeout(asrCompletionTimerRef.current)
      asrCompletionTimerRef.current = null
    }
  }, [])

  const closeASR = useCallback(() => {
    clearASRTimers()
    stopAudioStream()
    asrClientRef.current?.close()
    asrClientRef.current = null
    asrPendingRef.current = false
    asrReadyRef.current = false
    asrCommitRequestedRef.current = false
    pcmEncoderRef.current = null
    pcmSourceSampleRateRef.current = 0
    pendingPCMFramesRef.current = []
  }, [clearASRTimers, stopAudioStream])

  const discardPreparedRecording = useCallback(() => {
    if (pendingRecordingRef.current !== recordingRef.current) {
      pendingRecordingRef.current?.cleanup()
    }
    recordingRef.current?.cleanup()
    pendingRecordingRef.current = null
    recordingRef.current = null
    if (mountedRef.current) {
      setCompletedDurationMS(0)
      setRecording(null)
    }
  }, [])

  const publishPendingRecording = useCallback(() => {
    const pending = pendingRecordingRef.current
    if (!pending || asrPendingRef.current) return

    pendingRecordingRef.current = null
    recordingRef.current = pending
    if (mountedRef.current) {
      setRecording(pending)
      setError("")
    }
    setStatus("recorded")
  }, [setStatus])

  const fail = useCallback(
    async (caughtError: unknown) => {
      clearMaxDurationTimer()
      closeASR()
      await releaseRecordingMode()
      const message = getRecordingErrorMessage(caughtError)
      if (mountedRef.current) setError(message)
      setStatus("idle")
    },
    [clearMaxDurationTimer, closeASR, releaseRecordingMode, setStatus]
  )

  function failASR(asrClient: ASRRealtimeClient, message: string) {
    if (asrClientRef.current !== asrClient) return

    asrClientRef.current = null
    asrPendingRef.current = false
    asrReadyRef.current = false
    asrCommitRequestedRef.current = false
    pcmEncoderRef.current = null
    pcmSourceSampleRateRef.current = 0
    pendingPCMFramesRef.current = []
    clearASRTimers()
    stopAudioStream()
    asrClient.close()
    if (mountedRef.current) setTranscriptionError(message)
    publishPendingRecording()
  }

  function sendPCMFrames(frames: ArrayBuffer[]) {
    if (frames.length === 0 || !asrPendingRef.current) return
    const asrClient = asrClientRef.current
    if (!asrClient || !asrReadyRef.current) {
      pendingPCMFramesRef.current.push(...frames)
      return
    }
    try {
      frames.forEach((frame) => asrClient.sendAudio(frame))
    } catch (caughtError) {
      failASR(asrClient, getASRErrorMessage(caughtError))
    }
  }

  function commitASRIfReady() {
    const asrClient = asrClientRef.current
    if (
      !asrCommitRequestedRef.current ||
      !asrReadyRef.current ||
      !asrClient
    ) {
      return
    }
    asrCommitRequestedRef.current = false
    try {
      asrClient.commit()
      asrCompletionTimerRef.current = setTimeout(() => {
        failASR(asrClient, "语音识别响应超时")
      }, ASR_COMPLETION_TIMEOUT_MS)
    } catch (caughtError) {
      failASR(asrClient, getASRErrorMessage(caughtError))
    }
  }

  function handleAudioBuffer(buffer: AudioStreamBuffer) {
    if (!asrPendingRef.current) return
    const asrClient = asrClientRef.current
    if (!asrClient) return

    try {
      if (!pcmEncoderRef.current) {
        pcmEncoderRef.current = new PCM16StreamEncoder(buffer.sampleRate)
        pcmSourceSampleRateRef.current = buffer.sampleRate
      } else if (pcmSourceSampleRateRef.current !== buffer.sampleRate) {
        throw new Error("录音设备切换了采样率")
      }
      const samples = decodeFloat32Mono(buffer.data, buffer.channels)
      sendPCMFrames(pcmEncoderRef.current.push(samples))
    } catch (caughtError) {
      failASR(asrClient, getASRErrorMessage(caughtError))
    }
  }

  function startASR() {
    const asrClient = new ASRRealtimeClient({
      onCompleted: (text) => {
        if (asrClientRef.current !== asrClient) return
        asrClientRef.current = null
        asrPendingRef.current = false
        asrReadyRef.current = false
        asrCommitRequestedRef.current = false
        clearASRTimers()
        if (mountedRef.current) onTranscriptRef.current?.(text)
        publishPendingRecording()
      },
      onError: (message) => failASR(asrClient, message),
      onTranscript: (text) => {
        if (asrClientRef.current === asrClient && mountedRef.current) {
          onTranscriptRef.current?.(text)
        }
      },
      url: buildASRWebSocketUrl(serverUrl),
    })

    asrClientRef.current = asrClient
    asrPendingRef.current = true
    asrReadyRef.current = false
    asrCommitRequestedRef.current = false
    pcmEncoderRef.current = null
    pcmSourceSampleRateRef.current = 0
    pendingPCMFramesRef.current = []
    clearASRTimers()
    asrConnectTimerRef.current = setTimeout(() => {
      failASR(asrClient, "连接语音识别服务超时")
    }, ASR_CONNECT_TIMEOUT_MS)

    void asrClient
      .connect()
      .then(() => {
        if (asrClientRef.current !== asrClient) return
        if (asrConnectTimerRef.current !== null) {
          clearTimeout(asrConnectTimerRef.current)
          asrConnectTimerRef.current = null
        }
        asrReadyRef.current = true
        const pendingFrames = pendingPCMFramesRef.current
        pendingPCMFramesRef.current = []
        sendPCMFrames(pendingFrames)
        commitASRIfReady()
      })
      .catch((caughtError: unknown) => {
        failASR(asrClient, getASRErrorMessage(caughtError))
      })
  }

  async function stopRecording() {
    if (statusRef.current === "requesting") {
      stopRequestedRef.current = true
      return
    }
    if (statusRef.current !== "recording") return

    const operationVersion = operationVersionRef.current
    setStatus("processing")
    clearMaxDurationTimer()

    stopAudioStream()
    const encoder = pcmEncoderRef.current
    pcmEncoderRef.current = null
    pcmSourceSampleRateRef.current = 0
    if (encoder) sendPCMFrames(encoder.flush())
    if (asrPendingRef.current) {
      asrCommitRequestedRef.current = true
      commitASRIfReady()
    }

    try {
      await recorder.stop()
      const recorderStatus = recorder.getStatus()
      const uri = recorder.uri ?? recorderStatus.url
      const measuredDuration = Math.max(
        recorderStatus.durationMillis,
        currentTimestampMS() - startedAtRef.current
      )
      const durationMS = Math.min(
        VOICE_MESSAGE_MAX_DURATION_MS,
        Math.round(measuredDuration)
      )

      await releaseRecordingMode()

      if (operationVersionRef.current !== operationVersion) {
        if (uri) safeDeleteFile(new File(uri))
        return
      }
      if (!uri) throw new Error("没有生成有效的语音文件")

      const file = new File(uri)
      if (!file.exists || file.size <= 0) {
        safeDeleteFile(file)
        throw new Error("没有录制到有效的语音内容")
      }
      if (durationMS < VOICE_MESSAGE_MIN_DURATION_MS) {
        safeDeleteFile(file)
        throw new Error("录音时间太短，请重新录制")
      }
      if (file.size > VOICE_MESSAGE_MAX_BYTES) {
        safeDeleteFile(file)
        throw new Error("语音文件超过 1 MiB，请重新录制")
      }

      const prepared: PreparedClientVoiceMessage = {
        cleanup: createFileCleanup(uri),
        durationMS,
        upload: {
          mimeType: VOICE_RECORDING_FORMAT.mimeType,
          name: `voice-message${VOICE_RECORDING_FORMAT.extension}`,
          sizeBytes: file.size,
          uri,
        },
      }

      pendingRecordingRef.current = prepared
      if (mountedRef.current) setCompletedDurationMS(durationMS)
      if (asrPendingRef.current) setStatus("transcribing")
      publishPendingRecording()
    } catch (caughtError: unknown) {
      await fail(caughtError)
    }
  }

  useEffect(() => {
    stopRecordingRef.current = stopRecording
  })

  const discardPreparedNativeRecording = useCallback(async () => {
    const uri = recorder.uri || recorder.getStatus().url
    try {
      await recorder.stop()
    } catch {
      // Stopping a prepared recorder that never started can reject on some
      // devices, but still releases the native recording session.
    }
    if (uri) safeDeleteFile(new File(uri))
  }, [recorder])

  function beginRecorderPreparation() {
    const activePreparation = recorderPreparationRef.current
    if (activePreparation) return activePreparation

    const operationVersion = operationVersionRef.current + 1
    operationVersionRef.current = operationVersion
    stopRequestedRef.current = false
    clearMaxDurationTimer()
    closeASR()
    discardPreparedRecording()
    if (mountedRef.current) {
      setError("")
      setTranscriptionError("")
    }

    const preparation = (async () => {
      try {
        assertVoiceRecordingPlatformSupport()
        stopActiveVoicePlayback()

        const permission = await requestRecordingPermissionsAsync()
        if (!permission.granted) {
          throw new Error("需要麦克风权限才能发送语音消息")
        }
        if (
          stopRequestedRef.current ||
          operationVersionRef.current !== operationVersion
        ) {
          return false
        }

        await setAudioModeAsync({
          allowsRecording: true,
          interruptionMode: "doNotMix",
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        })
        if (
          stopRequestedRef.current ||
          operationVersionRef.current !== operationVersion
        ) {
          await releaseRecordingMode()
          return false
        }

        const currentRecorderStatus = recorder.getStatus()
        if (!currentRecorderStatus.canRecord) {
          await recorder.prepareToRecordAsync()
        }
        if (
          stopRequestedRef.current ||
          operationVersionRef.current !== operationVersion
        ) {
          await discardPreparedNativeRecording()
          await releaseRecordingMode()
          return false
        }

        return true
      } catch (caughtError: unknown) {
        if (
          !stopRequestedRef.current &&
          operationVersionRef.current === operationVersion
        ) {
          await fail(caughtError)
        }
        return false
      }
    })()

    recorderPreparationRef.current = preparation
    void preparation.then(() => {
      if (recorderPreparationRef.current === preparation) {
        recorderPreparationRef.current = null
      }
    })
    return preparation
  }

  async function ensureRecorderPrepared() {
    const currentRecorderStatus = recorder.getStatus()
    if (
      currentRecorderStatus.canRecord &&
      !currentRecorderStatus.isRecording
    ) {
      return true
    }

    return await beginRecorderPreparation()
  }

  async function prepareRecording() {
    if (statusRef.current !== "idle") return
    await ensureRecorderPrepared()
  }

  async function startRecording() {
    if (
      statusRef.current === "requesting" ||
      statusRef.current === "recording" ||
      statusRef.current === "processing" ||
      statusRef.current === "transcribing"
    ) {
      return
    }

    setStatus("requesting")

    try {
      if (!(await ensureRecorderPrepared())) {
        setStatus("idle")
        return
      }
      if (stopRequestedRef.current) {
        await discardPreparedNativeRecording()
        await releaseRecordingMode()
        setStatus("idle")
        return
      }

      const operationVersion = operationVersionRef.current
      startedAtRef.current = currentTimestampMS()
      recorder.record()
      setStatus("recording")
      maxDurationTimerRef.current = setTimeout(() => {
        void stopRecordingRef.current()
      }, VOICE_MESSAGE_MAX_DURATION_MS)

      try {
        startASR()
      } catch (caughtError: unknown) {
        if (mountedRef.current) {
          setTranscriptionError(getASRErrorMessage(caughtError))
        }
      }

      if (asrPendingRef.current) {
        try {
          await audioStream.start()
          if (
            operationVersionRef.current !== operationVersion ||
            !isRecordingActive()
          ) {
            stopAudioStream()
          }
        } catch (caughtError: unknown) {
          const asrClient = asrClientRef.current
          if (asrClient) failASR(asrClient, getASRErrorMessage(caughtError))
        }
      }
    } catch (caughtError: unknown) {
      await fail(caughtError)
    }
  }

  const resetRecording = useCallback((preservePreparedFile = false) => {
    operationVersionRef.current += 1
    stopRequestedRef.current = true
    clearMaxDurationTimer()
    closeASR()
    if (
      statusRef.current === "recording"
    ) {
      void recorder.stop().finally(() => releaseRecordingMode())
    } else if (statusRef.current === "requesting") {
      void releaseRecordingMode()
    } else {
      const recorderStatus = recorder.getStatus()
      if (recorderStatus.canRecord && !recorderStatus.isRecording) {
        void discardPreparedNativeRecording().finally(() =>
          releaseRecordingMode()
        )
      }
    }
    if (preservePreparedFile) {
      pendingRecordingRef.current = null
      recordingRef.current = null
    } else {
      discardPreparedRecording()
    }
    if (mountedRef.current) {
      setError("")
      setCompletedDurationMS(0)
      setTranscriptionError("")
    }
    setStatus("idle")
  }, [
    clearMaxDurationTimer,
    closeASR,
    discardPreparedNativeRecording,
    discardPreparedRecording,
    recorder,
    releaseRecordingMode,
    setStatus,
  ])

  const clearError = useCallback(() => {
    if (mountedRef.current) setError("")
  }, [])

  function isRecordingActive() {
    return statusRef.current === "recording"
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationVersionRef.current += 1
      stopRequestedRef.current = true
      clearMaxDurationTimer()
      closeASR()
      // useAudioRecorder owns the native shared object's release. Calling
      // recorder methods here races with that cleanup during Fast Refresh and
      // can access an object Expo has already released.
      void releaseRecordingMode()
    }
  }, [
    clearMaxDurationTimer,
    closeASR,
    releaseRecordingMode,
  ])

  return {
    clearError,
    elapsedMS:
      status === "recording"
        ? Math.min(VOICE_MESSAGE_MAX_DURATION_MS, recorderState.durationMillis)
        : (recording?.durationMS ?? completedDurationMS),
    error,
    recording,
    prepareRecording,
    resetRecording,
    startRecording,
    status,
    stopRecording,
    transcriptionError,
  }
}

function assertVoiceRecordingPlatformSupport() {
  if (Platform.OS === "android" && Number(Platform.Version) < 29) {
    throw new Error("当前 Android 版本暂不支持发送语音消息")
  }
}

function createFileCleanup(uri: string) {
  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    safeDeleteFile(new File(uri))
  }
}

function safeDeleteFile(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // Cache cleanup is best-effort; the operating system can reclaim this file.
  }
}

function getRecordingErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return "录音失败，请重新尝试"
}

function getASRErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return "语音识别失败"
}

function currentTimestampMS() {
  return Date.now()
}
