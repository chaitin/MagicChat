import { AudioLines } from "lucide-react-native"
import { Circle, Portal, SizableText, YStack } from "tamagui"

import type { VoiceMessageRecorderStatus } from "@/features/conversation/voice/use-voice-message-recorder"

const RECORDING_ARC_VISIBLE_HEIGHT = 108

export function MessageVoiceGestureOverlay({
  active,
  elapsedMS,
  screenWidth,
  status,
  transcript,
}: {
  active: boolean
  elapsedMS: number
  screenWidth: number
  status: VoiceMessageRecorderStatus
  transcript: string
}) {
  if (!active) return null

  return (
    <Portal stackZIndex={100_000}>
      <YStack
        bg="rgba(18, 18, 18, 0.74)"
        fullscreen
        pointerEvents="none"
      >
        <YStack flex={1} items="center" justify="center" pb={180} px="$6">
          <SizableText color="rgba(255,255,255,0.72)" mb="$4" size="$3">
            {formatRecordingDuration(elapsedMS)}
          </SizableText>
          <SizableText
            color="white"
            fontWeight="600"
            lineHeight="$7"
            maxW={560}
            numberOfLines={8}
            size="$6"
            text="center"
          >
            {getTranscriptText(status, transcript)}
          </SizableText>
        </YStack>

        <RecordingArc screenWidth={screenWidth} />

        <YStack
          items="center"
          position="absolute"
          style={{ bottom: 112, left: 0, right: 0 }}
        >
          <SizableText color="white" fontWeight="600" size="$4">
            松开结束录音
          </SizableText>
        </YStack>
      </YStack>
    </Portal>
  )
}

function RecordingArc({ screenWidth }: { screenWidth: number }) {
  const arcSize = screenWidth * 1.62

  return (
    <>
      <Circle
        bg="rgba(242,242,242,0.94)"
        borderColor="rgba(255,255,255,0.9)"
        borderWidth={1}
        position="absolute"
        size={arcSize}
        style={{
          bottom: -(arcSize - RECORDING_ARC_VISIBLE_HEIGHT),
          left: (screenWidth - arcSize) / 2,
        }}
      />
      <YStack
        items="center"
        position="absolute"
        style={{ bottom: 38, left: 0, right: 0 }}
      >
        <AudioLines color="#232323" size={32} strokeWidth={2} />
      </YStack>
    </>
  )
}

function getTranscriptText(
  status: VoiceMessageRecorderStatus,
  transcript: string
) {
  const content = transcript.trim()
  if (content) return content
  if (status === "requesting") return "正在准备录音…"
  if (status === "processing" || status === "transcribing") {
    return "正在完成语音识别…"
  }
  return "请说话…"
}

function formatRecordingDuration(durationMS: number) {
  const totalSeconds = Math.floor(durationMS / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
