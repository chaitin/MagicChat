import { useXGUIToast } from "@/xgui"
import { ImpactFeedbackStyle, impactAsync } from "expo-haptics"
import { useCallback, useEffect, useRef, useState } from "react"
import { Keyboard } from "react-native"

import type { PreparedClientVoiceMessage } from "@/data/messages/message-upload"
import { useVoiceMessageRecorder } from "@/features/conversation/voice/use-voice-message-recorder"

const VOICE_PREWARM_DELAY_MS = 300

export function useComposerVoice({
  disabled,
  onBeforeModeToggle,
  onReturnToText,
  onSendText,
  onSendVoice,
  serverUrl,
}: {
  disabled: boolean
  onBeforeModeToggle: () => void
  onReturnToText: () => void
  onSendText: (content: string) => Promise<boolean>
  onSendVoice: (recording: PreparedClientVoiceMessage) => Promise<boolean>
  serverUrl: string
}) {
  const toast = useXGUIToast()
  const [transcript, setTranscript] = useState("")
  const recorder = useVoiceMessageRecorder({
    onTranscript: setTranscript,
    serverUrl,
  })
  const dialogClosingRef = useRef(false)
  const mountedRef = useRef(true)
  const prewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingRef = useRef<PreparedClientVoiceMessage | null>(null)
  const uploadInFlightRef = useRef(false)
  const [mode, setMode] = useState(false)
  const [gestureActive, setGestureActive] = useState(false)
  const interactionActive =
    recorder.status === "requesting" ||
    recorder.status === "recording" ||
    recorder.status === "processing" ||
    recorder.status === "transcribing"
  const dialogOpen =
    mode &&
    (recorder.status === "processing" ||
      recorder.status === "transcribing" ||
      recorder.status === "recorded")
  const interactionDisabled = disabled || interactionActive || dialogOpen

  useEffect(() => {
    recordingRef.current = recorder.recording
  }, [recorder.recording])

  useEffect(() => {
    if (!recorder.error) return

    toast.show({ message: `${"无法录音"}：${recorder.error}`, modal: false, type: "text", duration: 1_000 })
    recorder.clearError()
  }, [recorder, toast])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (prewarmTimerRef.current !== null) {
        clearTimeout(prewarmTimerRef.current)
        prewarmTimerRef.current = null
      }
      if (!uploadInFlightRef.current) {
        recordingRef.current?.cleanup()
        recordingRef.current = null
      }
    }
  }, [])

  const cancelScheduledPrewarm = useCallback(() => {
    if (prewarmTimerRef.current !== null) {
      clearTimeout(prewarmTimerRef.current)
      prewarmTimerRef.current = null
    }
    dialogClosingRef.current = false
  }, [])

  const leaveMode = useCallback(() => {
    cancelScheduledPrewarm()
    setMode(false)
    recorder.resetRecording()
  }, [cancelScheduledPrewarm, recorder])

  const resetAndSchedulePrewarm = useCallback((preservePreparedFile = false) => {
    if (dialogClosingRef.current) return

    dialogClosingRef.current = true
    setTranscript("")
    recorder.resetRecording(preservePreparedFile)
    prewarmTimerRef.current = setTimeout(() => {
      prewarmTimerRef.current = null
      dialogClosingRef.current = false
      if (mountedRef.current && mode) {
        void recorder.prepareRecording()
      }
    }, VOICE_PREWARM_DELAY_MS)
  }, [mode, recorder])

  const toggleMode = useCallback(() => {
    if (interactionDisabled) return

    const nextMode = !mode
    onBeforeModeToggle()
    if (nextMode) {
      setMode(true)
      Keyboard.dismiss()
      void recorder.prepareRecording()
    } else {
      leaveMode()
      onReturnToText()
    }
  }, [
    interactionDisabled,
    leaveMode,
    mode,
    onBeforeModeToggle,
    onReturnToText,
    recorder,
  ])

  const pressIn = useCallback(() => {
    if (interactionDisabled || !mode) return
    cancelScheduledPrewarm()
    setGestureActive(true)
    setTranscript("")
    void impactAsync(ImpactFeedbackStyle.Medium)
    void recorder.startRecording()
  }, [cancelScheduledPrewarm, interactionDisabled, mode, recorder])

  const pressOut = useCallback(() => {
    if (!mode) return
    setGestureActive(false)
    void recorder.stopRecording()
  }, [mode, recorder])

  const confirm = useCallback(async () => {
    const recording = recorder.recording
    if (!recording || disabled) return

    uploadInFlightRef.current = true
    try {
      if (
        await onSendVoice({
          ...recording,
          transcript: transcript.trim(),
        })
      ) {
        resetAndSchedulePrewarm(true)
      }
    } finally {
      uploadInFlightRef.current = false
      if (!mountedRef.current && recordingRef.current === recording) {
        recording.cleanup()
        recordingRef.current = null
      }
    }
  }, [disabled, onSendVoice, recorder.recording, resetAndSchedulePrewarm, transcript])

  const sendText = useCallback(async () => {
    const message = transcript.trim()
    if (recorder.status !== "recorded" || !message || disabled) return

    if (await onSendText(message)) resetAndSchedulePrewarm()
  }, [disabled, onSendText, recorder.status, resetAndSchedulePrewarm, transcript])

  const cancel = useCallback(() => {
    setGestureActive(false)
    resetAndSchedulePrewarm()
  }, [resetAndSchedulePrewarm])

  return {
    cancel,
    confirm,
    dialogOpen,
    elapsedMS: recorder.elapsedMS,
    error: recorder.error,
    gestureActive,
    interactionActive,
    interactionDisabled,
    leaveMode,
    mode,
    pressIn,
    pressOut,
    recording: recorder.recording,
    sendText,
    status: recorder.status,
    toggleMode,
    transcript,
    transcriptionError: recorder.transcriptionError,
  }
}
