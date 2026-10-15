import { AudioLines } from "lucide-react-native"
import { StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"
import { XGUIOverlay } from "@/xgui/components/xgui-overlay-host"

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
    <XGUIOverlay priority={100_000}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(18, 18, 18, 0.74)" }]}>
        <View style={{ alignItems: "center", flex: 1, justifyContent: "center", paddingBottom: 180, paddingHorizontal: 32 }}>
          <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 21, marginBottom: 18 }}>
            {formatRecordingDuration(elapsedMS)}
          </Text>
          <Text numberOfLines={8} style={{ color: "white", fontSize: 16, fontWeight: "600", lineHeight: 33, maxWidth: 560, textAlign: "center" }}>
            {getTranscriptText(status, transcript)}
          </Text>
        </View>

        <RecordingArc screenWidth={screenWidth} />

        <View style={{ alignItems: "center", bottom: 112, left: 0, position: "absolute", right: 0 }}>
          <Text style={{ color: "white", fontSize: 15, fontWeight: "600", lineHeight: 23 }}>松开结束录音</Text>
        </View>
      </View>
    </XGUIOverlay>
  )
}

function RecordingArc({ screenWidth }: { screenWidth: number }) {
  const arcSize = screenWidth * 1.62

  return (
    <>
      <View style={{ backgroundColor: "rgba(242,242,242,0.94)", borderColor: "rgba(255,255,255,0.9)", borderRadius: arcSize / 2, borderWidth: 1, bottom: -(arcSize - RECORDING_ARC_VISIBLE_HEIGHT), height: arcSize, left: (screenWidth - arcSize) / 2, position: "absolute", width: arcSize }} />
      <View style={{ alignItems: "center", bottom: 38, left: 0, position: "absolute", right: 0 }}>
        <AudioLines color="#232323" size={32} strokeWidth={2} />
      </View>
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
