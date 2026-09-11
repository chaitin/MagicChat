import { Pressable, StyleSheet } from "react-native"
import { Button } from "tamagui"

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
      style={styles.pressTarget}
    >
      {({ pressed }) => (
        <Button
          accessible={false}
          bg="transparent"
          borderWidth={0}
          color={colors.textPrimary}
          disabled={disabled}
          forceStyle={pressed ? "press" : undefined}
          height="100%"
          minH={0}
          pointerEvents="none"
          pressStyle={{ bg: colors.background1 }}
          size="$4"
          width="100%"
        >
          {getVoicePrompt(status, elapsedMS)}
        </Button>
      )}
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
    flex: 1,
  },
})
