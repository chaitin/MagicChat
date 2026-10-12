import { Pressable, StyleSheet } from "react-native"

import { Text } from "@/components/mi-sans-text"

import type { VoiceMessageRecorderStatus } from "@/features/conversation/voice/use-voice-message-recorder"
import { useXGUITheme } from "@/xgui"

export function VoiceRecordButton({
  disabled,
  elapsedMS,
  onPressIn,
  onPressOut,
  screenHeight,
  screenWidth,
  status,
}: {
  disabled: boolean
  elapsedMS: number
  onPressIn: () => void
  onPressOut: () => void
  screenHeight: number
  screenWidth: number
  status: VoiceMessageRecorderStatus
}) {
  const { colors } = useXGUITheme()

  return (
    <Pressable
      accessibilityHint="按住开始录音，松开结束录音"
      accessibilityLabel="按住说话"
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      pressRetentionOffset={{
        bottom: screenHeight,
        left: screenWidth,
        right: screenWidth,
        top: screenHeight,
      }}
      style={({ pressed }) => [
        styles.pressTarget,
        pressed && { backgroundColor: colors.background1 },
      ]}
    >
      <Text style={[styles.label, { color: colors.textPrimary }]}>
        {getVoicePrompt(status, elapsedMS)}
      </Text>
    </Pressable>
  )
}

function getVoicePrompt(status: VoiceMessageRecorderStatus, elapsedMS: number) {
  if (status === "requesting" || status === "recording") {
    return `正在录音 ${formatRecordingDuration(elapsedMS)}`
  }
  if (status === "processing") return "正在生成语音…"
  if (status === "transcribing") return "正在识别语音…"
  return "按住说话"
}

function formatRecordingDuration(durationMS: number) {
  const totalSeconds = Math.floor(durationMS / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

const styles = StyleSheet.create({
  pressTarget: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  label: {
    fontSize: 15,
  },
})
