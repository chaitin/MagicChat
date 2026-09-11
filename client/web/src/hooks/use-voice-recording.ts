import * as React from "react"

import { ASRRealtimeClient } from "@/lib/asr-realtime-client"
import { PCM16StreamEncoder } from "@/lib/pcm-audio"
import {
  voiceMessageAudioBitsPerSecond,
  voiceMessageContentType,
  voiceMessageMaxBytes,
  voiceMessageMaxDurationMS,
  type VoiceMessageRecording,
} from "@/lib/voice-message"

export type VoiceRecordingStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "transcribing"
  | "recorded"

type UseVoiceRecordingOptions = {
  onTranscript?: (text: string) => void
}

const analyserFFTSize = 256
const waveformUpdateIntervalMS = 50

export function useVoiceRecording(options: UseVoiceRecordingOptions = {}) {
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const asrCaptureFinalizedRef = React.useRef(false)
  const asrClientRef = React.useRef<ASRRealtimeClient | null>(null)
  const asrCommitRequestedRef = React.useRef(false)
  const asrPendingRef = React.useRef(false)
  const asrReadyRef = React.useRef(false)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const animationFrameRef = React.useRef<number | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const finishingRef = React.useRef(false)
  const finishDelayTimeoutRef = React.useRef<number | null>(null)
  const lastWaveformUpdateRef = React.useRef(0)
  const maxDurationTimeoutRef = React.useRef<number | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const pcmEncoderRef = React.useRef<PCM16StreamEncoder | null>(null)
  const pendingPCMFramesRef = React.useRef<ArrayBuffer[]>([])
  const pendingRecordingRef = React.useRef<VoiceMessageRecording | null>(null)
  const recordingStartedAtRef = React.useRef(0)
  const requestVersionRef = React.useRef(0)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const stopFallbackTimeoutRef = React.useRef<number | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const workletRef = React.useRef<AudioWorkletNode | null>(null)
  const onTranscriptRef = React.useRef(options.onTranscript)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)
  const [error, setError] = React.useState("")
  const [level, setLevel] = React.useState(0)
  const [recording, setRecording] =
    React.useState<VoiceMessageRecording | null>(null)
  const [status, setStatus] = React.useState<VoiceRecordingStatus>("idle")
  const [transcriptionError, setTranscriptionError] = React.useState("")

  React.useEffect(() => {
    onTranscriptRef.current = options.onTranscript
  }, [options.onTranscript])

  const clearMaxDurationTimeout = React.useCallback(() => {
    if (maxDurationTimeoutRef.current !== null) {
      window.clearTimeout(maxDurationTimeoutRef.current)
      maxDurationTimeoutRef.current = null
    }
  }, [])

  const releaseMicrophone = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    workletRef.current?.disconnect()
    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    if (audioContextRef.current) {
      void audioContextRef.current.close()
    }

    workletRef.current = null
    pcmEncoderRef.current = null
    sourceRef.current = null
    analyserRef.current = null
    streamRef.current = null
    audioContextRef.current = null
  }, [])

  const clearFinishDelayTimeout = React.useCallback(() => {
    if (finishDelayTimeoutRef.current !== null) {
      window.clearTimeout(finishDelayTimeoutRef.current)
      finishDelayTimeoutRef.current = null
    }
  }, [])

  const clearStopFallbackTimeout = React.useCallback(() => {
    if (stopFallbackTimeoutRef.current !== null) {
      window.clearTimeout(stopFallbackTimeoutRef.current)
      stopFallbackTimeoutRef.current = null
    }
  }, [])

  const closeASR = React.useCallback(() => {
    asrClientRef.current?.close()
    asrClientRef.current = null
    asrCommitRequestedRef.current = false
    asrPendingRef.current = false
    asrReadyRef.current = false
    pendingPCMFramesRef.current = []
  }, [])

  const publishPendingRecording = React.useCallback(() => {
    const pending = pendingRecordingRef.current
    if (!pending || asrPendingRef.current) {
      return
    }
    pendingRecordingRef.current = null
    setElapsedSeconds(Math.ceil(pending.durationMS / 1_000))
    setLevel(0)
    setRecording(pending)
    setStatus("recorded")
  }, [])

  const discardMediaRecorder = React.useCallback(() => {
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    chunksRef.current = []

    if (!recorder) {
      return
    }

    recorder.ondataavailable = null
    recorder.onerror = null
    recorder.onstop = null

    if (recorder.state !== "inactive") {
      recorder.stop()
    }
  }, [])

  function failASR(asrClient: ASRRealtimeClient, message: string) {
    if (asrClientRef.current !== asrClient) return
    setTranscriptionError(message)
    asrClient.close()
    asrClientRef.current = null
    asrPendingRef.current = false
    asrReadyRef.current = false
    asrCommitRequestedRef.current = false
    pendingPCMFramesRef.current = []
    workletRef.current?.disconnect()
    workletRef.current = null
    pcmEncoderRef.current = null
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
    if (!asrCommitRequestedRef.current || !asrReadyRef.current || !asrClient) {
      return
    }
    asrCommitRequestedRef.current = false
    try {
      asrClient.commit()
    } catch (caughtError) {
      failASR(asrClient, getASRErrorMessage(caughtError))
    }
  }

  function finalizeASRCapture(recorder: MediaRecorder) {
    if (asrCaptureFinalizedRef.current) return
    asrCaptureFinalizedRef.current = true
    clearStopFallbackTimeout()

    const encoder = pcmEncoderRef.current
    if (encoder) sendPCMFrames(encoder.flush())
    if (asrPendingRef.current) {
      asrCommitRequestedRef.current = true
      commitASRIfReady()
    }
    if (recorder.state !== "inactive") recorder.stop()
  }

  function finishRecording(delayMS = 500) {
    clearMaxDurationTimeout()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive" || finishingRef.current) {
      return
    }

    finishingRef.current = true
    setStatus("processing")
    const audioTime = audioContextRef.current?.currentTime ?? 0
    const elapsedMS = (audioTime - recordingStartedAtRef.current) * 1_000
    const boundedDelayMS = Math.min(
      delayMS,
      Math.max(0, voiceMessageMaxDurationMS - elapsedMS)
    )
    finishDelayTimeoutRef.current = window.setTimeout(() => {
      finishDelayTimeoutRef.current = null
      flushAndStopRecording(recorder)
    }, boundedDelayMS)
  }

  function flushAndStopRecording(recorder: MediaRecorder) {
    if (recorder.state === "inactive") return
    const worklet = workletRef.current
    if (worklet && pcmEncoderRef.current) {
      worklet.port.postMessage({ type: "flush" })
      stopFallbackTimeoutRef.current = window.setTimeout(() => {
        finalizeASRCapture(recorder)
      }, 500)
      return
    }
    recorder.stop()
  }

  React.useEffect(() => {
    if (status !== "recording") {
      return
    }

    const interval = window.setInterval(() => {
      const audioTime = audioContextRef.current?.currentTime ?? 0
      const elapsedMS = (audioTime - recordingStartedAtRef.current) * 1_000
      setElapsedSeconds(
        Math.min(60, Math.max(0, Math.floor(elapsedMS / 1_000)))
      )
    }, 250)

    return () => window.clearInterval(interval)
  }, [status])

  React.useEffect(
    () => () => {
      requestVersionRef.current += 1
      clearMaxDurationTimeout()
      clearFinishDelayTimeout()
      clearStopFallbackTimeout()
      discardMediaRecorder()
      closeASR()
      releaseMicrophone()
    },
    [
      clearFinishDelayTimeout,
      clearMaxDurationTimeout,
      clearStopFallbackTimeout,
      closeASR,
      discardMediaRecorder,
      releaseMicrophone,
    ]
  )

  async function startRecording() {
    if (
      status === "requesting" ||
      status === "recording" ||
      status === "processing" ||
      status === "transcribing"
    ) {
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    clearMaxDurationTimeout()
    clearFinishDelayTimeout()
    clearStopFallbackTimeout()
    discardMediaRecorder()
    closeASR()
    releaseMicrophone()
    asrCaptureFinalizedRef.current = false
    finishingRef.current = false
    pendingRecordingRef.current = null
    setElapsedSeconds(0)
    setError("")
    setTranscriptionError("")
    setLevel(0)
    setRecording(null)
    setStatus("requesting")

    if (!window.isSecureContext) {
      setError("麦克风只能在 HTTPS 或 localhost 下使用")
      setStatus("idle")
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风访问")
      setStatus("idle")
      return
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported(voiceMessageContentType)
    ) {
      setError("当前浏览器不支持 WebM/Opus 录音")
      setStatus("idle")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      if (requestVersionRef.current !== requestVersion) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: voiceMessageAudioBitsPerSecond,
        mimeType: voiceMessageContentType,
      })

      analyser.fftSize = analyserFFTSize
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)

      streamRef.current = stream
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      configureMediaRecorder(recorder, audioContext, requestVersion)
      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }
      if (requestVersionRef.current !== requestVersion) {
        discardMediaRecorder()
        releaseMicrophone()
        return
      }

      const pcmCaptureReady = await preparePCMCapture(
        audioContext,
        source,
        recorder,
        requestVersion
      )
      if (requestVersionRef.current !== requestVersion) {
        discardMediaRecorder()
        closeASR()
        releaseMicrophone()
        return
      }

      recordingStartedAtRef.current = audioContext.currentTime
      recorder.start(250)
      workletRef.current?.port.postMessage({ type: "start" })
      setStatus("recording")
      if (pcmCaptureReady) {
        void connectASR(requestVersion)
      }
      monitorMicrophoneLevel(analyser)
      maxDurationTimeoutRef.current = window.setTimeout(
        () => finishRecording(0),
        voiceMessageMaxDurationMS
      )
    } catch (caughtError) {
      if (requestVersionRef.current !== requestVersion) {
        return
      }

      clearMaxDurationTimeout()
      discardMediaRecorder()
      closeASR()
      releaseMicrophone()
      setError(getMicrophoneErrorMessage(caughtError))
      setStatus("idle")
    }
  }

  function configureMediaRecorder(
    recorder: MediaRecorder,
    audioContext: AudioContext,
    requestVersion: number
  ) {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onerror = () => {
      if (requestVersionRef.current !== requestVersion) return
      requestVersionRef.current += 1
      clearMaxDurationTimeout()
      clearFinishDelayTimeout()
      clearStopFallbackTimeout()
      discardMediaRecorder()
      closeASR()
      releaseMicrophone()
      setError("录音失败，请重新尝试")
      setLevel(0)
      setStatus("idle")
    }
    recorder.onstop = () => {
      const durationMS = Math.min(
        voiceMessageMaxDurationMS,
        Math.max(
          1,
          Math.round(
            (audioContext.currentTime - recordingStartedAtRef.current) * 1_000
          )
        )
      )
      const blob = new Blob(chunksRef.current, {
        type: voiceMessageContentType,
      })

      mediaRecorderRef.current = null
      chunksRef.current = []
      releaseMicrophone()

      if (requestVersionRef.current !== requestVersion) return
      if (blob.size <= 0) {
        closeASR()
        setError("没有录制到有效的语音内容")
        setStatus("idle")
        return
      }
      if (blob.size > voiceMessageMaxBytes) {
        closeASR()
        setError("语音文件超过 1MiB，请重新录制")
        setStatus("idle")
        return
      }

      pendingRecordingRef.current = { blob, durationMS }
      if (asrPendingRef.current) {
        setStatus("transcribing")
      } else {
        publishPendingRecording()
      }
    }
  }

  async function preparePCMCapture(
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
    recorder: MediaRecorder,
    requestVersion: number
  ) {
    if (!audioContext.audioWorklet) {
      setTranscriptionError("当前浏览器不支持实时语音识别")
      return false
    }

    try {
      await loadPCMCaptureWorklet(audioContext)
      if (requestVersionRef.current !== requestVersion) return false

      const worklet = new AudioWorkletNode(audioContext, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      })
      const encoder = new PCM16StreamEncoder(audioContext.sampleRate)
      workletRef.current = worklet
      pcmEncoderRef.current = encoder
      worklet.onprocessorerror = () => {
        if (requestVersionRef.current !== requestVersion) return
        const asrClient = asrClientRef.current
        if (asrClient) {
          failASR(asrClient, "实时音频处理失败")
        } else {
          setTranscriptionError("实时音频处理失败")
        }
        if (finishingRef.current) finalizeASRCapture(recorder)
      }
      worklet.port.onmessage = (event) => {
        if (requestVersionRef.current !== requestVersion) return
        if (event.data?.type === "samples") {
          sendPCMFrames(encoder.push(event.data.samples as Float32Array))
        } else if (event.data?.type === "flushed") {
          finalizeASRCapture(recorder)
        }
      }
      source.connect(worklet)
      return true
    } catch (caughtError) {
      setTranscriptionError(getASRErrorMessage(caughtError))
      return false
    }
  }

  async function connectASR(requestVersion: number) {
    const asrClient = new ASRRealtimeClient({
      onTranscript: (text) => {
        if (requestVersionRef.current === requestVersion) {
          onTranscriptRef.current?.(text)
        }
      },
      onCompleted: (text) => {
        if (requestVersionRef.current !== requestVersion) return
        onTranscriptRef.current?.(text)
        asrPendingRef.current = false
        asrReadyRef.current = false
        asrCommitRequestedRef.current = false
        asrClientRef.current = null
        pendingPCMFramesRef.current = []
        publishPendingRecording()
      },
      onError: (message) => {
        if (requestVersionRef.current !== requestVersion) return
        failASR(asrClient, message)
      },
    })

    asrClientRef.current = asrClient
    asrPendingRef.current = true
    try {
      await asrClient.connect()
      if (requestVersionRef.current !== requestVersion) {
        asrClient.close()
        return
      }
      asrReadyRef.current = true
      const pendingFrames = pendingPCMFramesRef.current
      pendingPCMFramesRef.current = []
      sendPCMFrames(pendingFrames)
      commitASRIfReady()
    } catch (caughtError) {
      if (
        requestVersionRef.current === requestVersion &&
        asrClientRef.current === asrClient
      ) {
        failASR(asrClient, getASRErrorMessage(caughtError))
      }
    }
  }

  function monitorMicrophoneLevel(analyser: AnalyserNode) {
    const samples = new Uint8Array(analyser.fftSize)

    function update(timestamp: number) {
      if (analyserRef.current !== analyser) return

      if (
        timestamp - lastWaveformUpdateRef.current >=
        waveformUpdateIntervalMS
      ) {
        analyser.getByteTimeDomainData(samples)
        let sumOfSquares = 0
        for (const sample of samples) {
          const normalizedSample = (sample - 128) / 128
          sumOfSquares += normalizedSample * normalizedSample
        }
        setLevel(
          Math.min(1, Math.max(0, Math.sqrt(sumOfSquares / samples.length) * 8))
        )
        lastWaveformUpdateRef.current = timestamp
      }
      animationFrameRef.current = window.requestAnimationFrame(update)
    }

    animationFrameRef.current = window.requestAnimationFrame(update)
  }

  function resetRecording() {
    requestVersionRef.current += 1
    clearMaxDurationTimeout()
    clearFinishDelayTimeout()
    clearStopFallbackTimeout()
    discardMediaRecorder()
    closeASR()
    releaseMicrophone()
    asrCaptureFinalizedRef.current = false
    finishingRef.current = false
    pendingRecordingRef.current = null
    setElapsedSeconds(0)
    setError("")
    setTranscriptionError("")
    setLevel(0)
    setRecording(null)
    setStatus("idle")
  }

  return {
    elapsedSeconds,
    error,
    level,
    recording,
    resetRecording,
    startRecording,
    status,
    stopRecording: finishRecording,
    transcriptionError,
  }
}

function getMicrophoneErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "无法访问麦克风，请稍后重试"
  }

  switch (error.name) {
    case "NotAllowedError":
      return "未获得麦克风权限，请在浏览器设置中允许访问"
    case "NotFoundError":
      return "没有检测到可用的麦克风"
    case "NotReadableError":
      return "麦克风暂时不可用，可能正在被其他应用占用"
    default:
      return "无法访问麦克风，请稍后重试"
  }
}

function loadPCMCaptureWorklet(audioContext: AudioContext) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("实时音频处理加载超时")),
      2_000
    )
    audioContext.audioWorklet.addModule("/pcm-capture-worklet.js").then(
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function getASRErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "实时语音识别不可用"
}
