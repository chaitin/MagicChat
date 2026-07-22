import * as React from "react"
import { AudioLines, LoaderCircle, Pause, Play } from "lucide-react"

import type { ClientVoiceMessageBody } from "@/lib/client-data-api"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

type MessageVoiceProps = {
  voice: ClientVoiceMessageBody
}

let activeVoiceAudio: HTMLAudioElement | null = null

export function MessageVoice({ voice }: MessageVoiceProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const durationSeconds = voice.durationMS / 1_000

  React.useEffect(
    () => () => {
      const audio = audioRef.current
      if (audio && activeVoiceAudio === audio) {
        activeVoiceAudio = null
      }
      audio?.pause()
    },
    []
  )

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio || loading) {
      return
    }

    if (!audio.paused) {
      audio.pause()
      return
    }

    setLoading(true)
    setError(false)

    try {
      if (activeVoiceAudio && activeVoiceAudio !== audio) {
        activeVoiceAudio.pause()
      }
      activeVoiceAudio = audio
      await audio.play()
    } catch {
      setError(true)
      setPlaying(false)
    } finally {
      setLoading(false)
    }
  }

  function handleSeek(value: number[]) {
    const nextTime = value[0] ?? 0
    const audio = audioRef.current

    setCurrentTime(nextTime)
    if (audio) {
      audio.currentTime = nextTime
    }
  }

  return (
    <div className="flex w-120 max-w-full items-center gap-3">
      <audio
        ref={audioRef}
        onEnded={() => {
          setCurrentTime(0)
          setPlaying(false)
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        preload="none"
        src={`/api/client/temporary-files/${encodeURIComponent(voice.fileId)}/content`}
      />
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background/50 text-muted-foreground">
        <AudioLines className="size-5" />
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <Slider
          aria-label="语音播放进度"
          disabled={error}
          max={durationSeconds}
          min={0}
          onValueChange={handleSeek}
          step={0.01}
          value={[Math.min(currentTime, durationSeconds)]}
        />
        <div className="text-xs leading-snug text-muted-foreground tabular-nums">
          {error ? "加载失败" : `${Math.max(1, Math.ceil(durationSeconds))} 秒`}
        </div>
      </div>
      <Button
        aria-label={playing ? "暂停语音" : "播放语音"}
        className="hover:bg-background/70 data-[state=open]:bg-background/70 dark:hover:bg-background/70 dark:data-[state=open]:bg-background/70"
        onClick={() => void handlePlayToggle()}
        size="icon-sm"
        title={playing ? "暂停" : "播放"}
        type="button"
        variant="ghost"
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : playing ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </Button>
    </div>
  )
}
