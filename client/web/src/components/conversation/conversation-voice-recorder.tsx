import type { VoiceRecordingStatus } from "@/hooks/use-voice-recording"
import { cn } from "@/lib/utils"

const waveformBarHeights = [
  24, 40, 58, 34, 68, 46, 76, 52, 86, 62, 72, 44, 80, 56, 38, 64, 48, 30,
]

export function VoiceRecordingPanel({
  elapsedSeconds,
  level,
  status,
}: {
  elapsedSeconds: number
  level: number
  status: VoiceRecordingStatus
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-4">
      <div className="flex h-24 items-center justify-center gap-1 overflow-hidden rounded-md bg-background px-4">
        {waveformBarHeights.map((height, index) => (
          <span
            key={`${height}-${index}`}
            aria-hidden="true"
            className={cn(
              "w-1 rounded-full transition-[height,background-color] duration-75",
              status === "recording"
                ? "bg-teal-500"
                : status === "recorded"
                  ? "bg-foreground/40"
                  : "bg-muted-foreground/20"
            )}
            style={{
              height: `${getWaveformBarHeight(height, index, level, status)}%`,
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {status === "requesting"
            ? "正在连接麦克风"
            : status === "processing"
              ? "正在结束录音"
              : status === "transcribing"
                ? "正在完成识别"
                : status === "recording"
                  ? "正在录音"
                  : status === "recorded"
                    ? "录音完成"
                    : "准备录音"}
        </span>
        <span className="font-mono tabular-nums">
          {formatVoiceRecordingDuration(elapsedSeconds)}
        </span>
      </div>
    </div>
  )
}

function getWaveformBarHeight(
  baseHeight: number,
  index: number,
  level: number,
  status: VoiceRecordingStatus
) {
  if (status === "recorded") {
    return baseHeight
  }

  if (status !== "recording") {
    return 8
  }

  const centerDistance = Math.abs(index - (waveformBarHeights.length - 1) / 2)
  const centerWeight = 1 - centerDistance / waveformBarHeights.length

  return Math.min(100, 8 + level * baseHeight * (0.85 + centerWeight * 0.5))
}

function formatVoiceRecordingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
