import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio"
import { File } from "expo-file-system"
import { useCallback, useEffect, useRef, useState } from "react"
import { Platform } from "react-native"

import type { PreparedClientVoiceMessage } from "@/data/message-upload"
import { stopActiveVoicePlayback } from "@/features/conversation/voice-message-player-state"

export const VOICE_MESSAGE_MAX_BYTES = 1 * 1024 * 1024
export const VOICE_MESSAGE_MAX_DURATION_MS = 60_000

const VOICE_MESSAGE_MIN_DURATION_MS = 500
const VOICE_MESSAGE_CONTENT_TYPE = "audio/webm"

const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  android: {
    audioEncoder: "opus",
    audioSource: "voice_communication",
    maxFileSize: VOICE_MESSAGE_MAX_BYTES,
    outputFormat: "webm",
  },
  bitRate: 24_000,
  directory: "cache",
  extension: ".webm",
  ios: {
    audioQuality: AudioQuality.MEDIUM,
    outputFormat: IOSOutputFormat.MPEG4AAC,
  },
  isMeteringEnabled: true,
  numberOfChannels: 1,
  sampleRate: 48_000,
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
  | "recorded"

export function useVoiceMessageRecorder() {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS)
  const recorderState = useAudioRecorderState(recorder, 100)
  const mountedRef = useRef(true)
  const operationVersionRef = useRef(0)
  const startedAtRef = useRef(0)
  const statusRef = useRef<VoiceMessageRecorderStatus>("idle")
  const stopRequestedRef = useRef(false)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingRef = useRef<PreparedClientVoiceMessage | null>(null)
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const [error, setError] = useState("")
  const [recording, setRecording] =
    useState<PreparedClientVoiceMessage | null>(null)
  const [status, setStatusState] =
    useState<VoiceMessageRecorderStatus>("idle")

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

  const discardPreparedRecording = useCallback(() => {
    recordingRef.current?.cleanup()
    recordingRef.current = null
    if (mountedRef.current) setRecording(null)
  }, [])

  const fail = useCallback(
    async (caughtError: unknown) => {
      clearMaxDurationTimer()
      await releaseRecordingMode()
      const message = getRecordingErrorMessage(caughtError)
      if (mountedRef.current) setError(message)
      setStatus("idle")
    },
    [clearMaxDurationTimer, releaseRecordingMode, setStatus]
  )

  const stopRecording = useCallback(async () => {
    if (statusRef.current === "requesting") {
      stopRequestedRef.current = true
      return
    }
    if (statusRef.current !== "recording") return

    setStatus("processing")
    clearMaxDurationTimer()

    try {
      await recorder.stop()
      const recorderStatus = recorder.getStatus()
      const uri = recorder.uri ?? recorderStatus.url
      const measuredDuration = Math.max(
        recorderStatus.durationMillis,
        Date.now() - startedAtRef.current
      )
      const durationMS = Math.min(
        VOICE_MESSAGE_MAX_DURATION_MS,
        Math.round(measuredDuration)
      )

      await releaseRecordingMode()

      if (!uri) throw new Error("没有生成有效的语音文件")

      const file = new File(uri)
      if (!file.exists || file.size <= 0) {
        safeDeleteFile(file)
        throw new Error("没有录制到有效的语音内容")
      }
      if (durationMS < VOICE_MESSAGE_MIN_DURATION_MS) {
        safeDeleteFile(file)
        throw new Error("录音时间太短，请按住后再说话")
      }
      if (file.size > VOICE_MESSAGE_MAX_BYTES) {
        safeDeleteFile(file)
        throw new Error("语音文件超过 1 MiB，请重新录制")
      }

      const prepared: PreparedClientVoiceMessage = {
        cleanup: createFileCleanup(uri),
        durationMS,
        upload: {
          mimeType: VOICE_MESSAGE_CONTENT_TYPE,
          name: "voice-message.webm",
          sizeBytes: file.size,
          uri,
        },
      }

      recordingRef.current = prepared
      if (mountedRef.current) {
        setRecording(prepared)
        setError("")
      }
      setStatus("recorded")
    } catch (caughtError: unknown) {
      await fail(caughtError)
    }
  }, [clearMaxDurationTimer, fail, recorder, releaseRecordingMode, setStatus])

  useEffect(() => {
    stopRecordingRef.current = stopRecording
  }, [stopRecording])

  const startRecording = useCallback(async () => {
    if (
      statusRef.current === "requesting" ||
      statusRef.current === "recording" ||
      statusRef.current === "processing"
    ) {
      return
    }

    const operationVersion = operationVersionRef.current + 1
    operationVersionRef.current = operationVersion
    stopRequestedRef.current = false
    clearMaxDurationTimer()
    discardPreparedRecording()
    if (mountedRef.current) setError("")
    setStatus("requesting")

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
        setStatus("idle")
        return
      }

      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      })
      await recorder.prepareToRecordAsync()
      if (
        stopRequestedRef.current ||
        operationVersionRef.current !== operationVersion
      ) {
        await releaseRecordingMode()
        setStatus("idle")
        return
      }

      startedAtRef.current = Date.now()
      recorder.record()
      setStatus("recording")
      maxDurationTimerRef.current = setTimeout(() => {
        void stopRecordingRef.current()
      }, VOICE_MESSAGE_MAX_DURATION_MS)
    } catch (caughtError: unknown) {
      await fail(caughtError)
    }
  }, [
    clearMaxDurationTimer,
    discardPreparedRecording,
    fail,
    recorder,
    releaseRecordingMode,
    setStatus,
  ])

  const resetRecording = useCallback(() => {
    operationVersionRef.current += 1
    stopRequestedRef.current = true
    clearMaxDurationTimer()
    discardPreparedRecording()
    if (mountedRef.current) setError("")
    setStatus("idle")
  }, [clearMaxDurationTimer, discardPreparedRecording, setStatus])

  const clearError = useCallback(() => {
    if (mountedRef.current) setError("")
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationVersionRef.current += 1
      stopRequestedRef.current = true
      clearMaxDurationTimer()
      if (statusRef.current === "recording") void recorder.stop()
      void releaseRecordingMode()
    }
  }, [clearMaxDurationTimer, recorder, releaseRecordingMode])

  return {
    clearError,
    elapsedMS:
      status === "recording"
        ? Math.min(VOICE_MESSAGE_MAX_DURATION_MS, recorderState.durationMillis)
        : (recording?.durationMS ?? 0),
    error,
    recording,
    resetRecording,
    startRecording,
    status,
    stopRecording,
  }
}

function assertVoiceRecordingPlatformSupport() {
  if (Platform.OS === "android" && Number(Platform.Version) < 29) {
    throw new Error("当前 Android 版本暂不支持发送语音消息")
  }
  if (Platform.OS === "ios") {
    throw new Error("当前版本暂不支持在 iPhone 上发送语音消息")
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
