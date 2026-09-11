import { Mic } from "lucide-react-native"
import { useCallback } from "react"
import { StyleSheet, Text, View } from "react-native"

import type { PreparedClientVoiceMessage } from "@/data/messages/message-upload"
import { formatVoiceDuration } from "@/domain/messages/message-presenter"
import { VoiceRecordingPreviewButton } from "@/features/conversation/voice/voice-recording-preview-button"
import type { VoiceMessageRecorderStatus } from "@/features/conversation/voice/use-voice-message-recorder"
import {
  XGUIActionSheet,
  type XGUIActionSheetAction,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function MessageVoiceDialog({
  elapsedMS,
  error,
  onCancel,
  onSendText,
  onSendVoice,
  open,
  recording,
  sending,
  status,
  transcript,
  transcriptionError,
}: {
  elapsedMS: number
  error: string
  onCancel: () => void
  onSendText: () => void
  onSendVoice: () => void
  open: boolean
  recording: PreparedClientVoiceMessage | null
  sending: boolean
  status: VoiceMessageRecorderStatus
  transcript: string
  transcriptionError: string
}) {
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const recorded = status === "recorded"
  const showPlaybackError = useCallback(
    (message: string) => {
      toast.show({
        duration: 1_000,
        message: `无法播放语音：${message}`,
        modal: false,
        type: "text",
      })
    },
    [toast]
  )
  const actions: XGUIActionSheetAction[] = recorded
    ? [
        {
          closeOnPress: false,
          disabled: !recording || sending,
          label: "发送语音",
          onPress: onSendVoice,
        },
        {
          closeOnPress: false,
          disabled: !transcript.trim() || sending,
          label: "发送文本",
          onPress: onSendText,
        },
      ]
    : status === "processing" || status === "transcribing"
      ? [
          {
            closeOnPress: false,
            disabled: true,
            label: status === "transcribing" ? "正在识别" : "正在结束",
            onPress: () => undefined,
          },
        ]
      : []

  return (
    <XGUIActionSheet
      actions={actions}
      cancelDisabled={sending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !sending) onCancel()
      }}
      open={open}
      title="语音输入"
    >
      <View style={styles.content}>
        <View style={[styles.preview, { backgroundColor: colors.background1 }]}>
          {recorded && recording ? (
            <VoiceRecordingPreviewButton
              disabled={sending}
              onPlaybackError={showPlaybackError}
              uri={recording.upload.uri}
            />
          ) : (
            <Mic color={colors.brand} size={34} strokeWidth={1.7} />
          )}
          <Text style={[styles.status, { color: colors.textSecondary }]}>
            {getStatusText(status, elapsedMS)}
          </Text>
        </View>

        {error ? (
          <Text style={[styles.message, { color: colors.destructive }]}>
            {error}
          </Text>
        ) : null}
        {transcriptionError ? (
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {transcriptionError}，仍可发送语音
          </Text>
        ) : null}

        {status !== "idle" ? (
          <View style={styles.transcriptSection}>
            <Text style={[styles.transcript, { color: colors.textSecondary }]}>
              {getTranscriptText(status, transcript)}
            </Text>
          </View>
        ) : null}
      </View>
    </XGUIActionSheet>
  )
}

function getTranscriptText(
  status: VoiceMessageRecorderStatus,
  transcript: string
) {
  const content = transcript.trim()
  if (content) return content
  if (status === "recorded") return "未识别到文字内容"
  return "正在识别语音内容…"
}

function getStatusText(status: VoiceMessageRecorderStatus, elapsedMS: number) {
  if (status === "idle") return "点击开始录音"
  if (status === "requesting") return "正在准备麦克风和语音识别"
  if (status === "recording") {
    return `正在录音 ${formatVoiceDuration(Math.max(1, elapsedMS))}`
  }
  if (status === "processing") return "正在生成语音"
  if (status === "transcribing") return "正在完成语音识别"
  return `语音 ${formatVoiceDuration(elapsedMS)}`
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  preview: {
    alignItems: "center",
    borderRadius: 8,
    gap: 12,
    justifyContent: "center",
    minHeight: 112,
  },
  status: {
    fontSize: 14,
    lineHeight: 20,
  },
  transcript: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  transcriptSection: {
    alignItems: "center",
  },
})
