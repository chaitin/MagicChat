import * as React from "react"
import { toast } from "sonner"

import {
  readTemporaryFileURLs,
  type ClientVoiceMessageBody,
} from "@/lib/client-data-api"
import { cn } from "@/lib/utils"
import { MessageContentIcon } from "@/components/message-content-icon"
import { Button } from "@/components/ui/button"

type MessageVoiceProps = { voice: ClientVoiceMessageBody }
type PlaybackState = "idle" | "loading" | "playing" | "paused"
const voicePlaybackStartTimeoutMS = 15_000
let activeVoiceAudio: HTMLAudioElement | null = null

export function MessageVoice({ voice }: MessageVoiceProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const audioURLPromiseRef = React.useRef<Promise<string> | null>(null)
  const requestRef = React.useRef(0)
  const pendingRef = React.useRef(false)
  const errorReportedRef = React.useRef(false)
  const [state, setState] = React.useState<PlaybackState>("idle")
  const [elapsedMS, setElapsedMS] = React.useState(0)
  const loading = state === "loading"
  const playing = state === "playing"
  const displayedDuration = state === "idle" ? voice.durationMS : elapsedMS

  React.useEffect(() => {
    const audio = audioRef.current
    return () => {
      requestRef.current += 1
      if (audio && activeVoiceAudio === audio) activeVoiceAudio = null
      audio?.pause()
    }
  }, [])

  function prepareAudio() {
    const audio = audioRef.current
    if (!audio) return Promise.reject(new Error("audio is unavailable"))
    audioURLPromiseRef.current ??= readTemporaryFileURLs([voice.fileId])
      .then((urls) => {
        const resolved = urls.find((item) => item.fileId === voice.fileId) ?? urls[0]
        if (!resolved) throw new Error("missing voice read url")
        if (!audio.isConnected) throw new Error("audio is unavailable")
        audio.src = resolved.url
        audio.load()
        return resolved.url
      })
      .catch((cause) => {
        audioURLPromiseRef.current = null
        throw cause
      })
    return audioURLPromiseRef.current
  }

  function reportPlaybackError() {
    requestRef.current += 1
    pendingRef.current = false
    if (activeVoiceAudio === audioRef.current) activeVoiceAudio = null
    audioURLPromiseRef.current = null
    setState("idle")
    setElapsedMS(0)
    if (!errorReportedRef.current) toast.error("语音播放失败")
    errorReportedRef.current = true
  }

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio || loading || pendingRef.current) return
    if (playing) {
      audio.pause()
      setState("paused")
      return
    }
    const request = ++requestRef.current
    pendingRef.current = true
    errorReportedRef.current = false
    setState("loading")
    try {
      await prepareAudio()
      if (request !== requestRef.current) return
      if (activeVoiceAudio && activeVoiceAudio !== audio) activeVoiceAudio.pause()
      activeVoiceAudio = audio
      if (audio.ended) audio.currentTime = 0
      await startAudioPlayback(audio)
      if (request === requestRef.current) setState("playing")
    } catch {
      if (request !== requestRef.current) return
      if (activeVoiceAudio === audio) activeVoiceAudio = null
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      reportPlaybackError()
    } finally {
      if (request === requestRef.current) pendingRef.current = false
    }
  }

  return (
    <div className="flex w-80 max-w-full items-center gap-3">
      <audio
        className="hidden"
        ref={audioRef}
        onEnded={() => { setState("idle"); setElapsedMS(0) }}
        onPause={() => setState((current) => current === "idle" ? current : "paused")}
        onError={reportPlaybackError}
        onPlaying={() => setState("playing")}
        onWaiting={(event) => { if (!event.currentTarget.paused) setState("loading") }}
        onTimeUpdate={(event) => setElapsedMS(event.currentTarget.currentTime * 1_000)}
        preload="none"
      />
      <MessageContentIcon kind="voice" className="size-7 shrink-0 text-foreground" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="truncate leading-6">语音 - {formatPlaybackTime(displayedDuration)}</div>
        <div className="truncate text-xs text-muted-foreground">{voice.transcript || "暂无文字摘要"}</div>
      </div>
      <Button
        aria-label={loading ? "正在加载语音" : playing ? "暂停语音" : "播放语音"}
        aria-busy={loading}
        className="shrink-0 hover:bg-foreground/5 active:bg-foreground/5 dark:hover:bg-foreground/5"
        disabled={loading}
        onClick={() => void handlePlayToggle()}
        onFocus={() => void prepareAudio().catch(() => undefined)}
        onPointerEnter={() => void prepareAudio().catch(() => undefined)}
        size="icon-sm"
        title={loading ? "正在加载" : playing ? "暂停" : "播放"}
        type="button"
        variant="ghost"
      >
        <MessageContentIcon kind={loading ? "loading" : playing ? "pause" : "play"} className={cn("size-4 group-hover/message-bubble:text-xgui-brand-5", loading && "animate-spin")} strokeWidth={1.5} />
      </Button>
    </div>
  )
}

async function startAudioPlayback(audio: HTMLAudioElement) {
  let timeoutID = 0
  try {
    await Promise.race([
      audio.play(),
      new Promise<never>((_resolve, reject) => {
        timeoutID = window.setTimeout(() => reject(new Error("voice playback timed out")), voicePlaybackStartTimeoutMS)
      }),
    ])
  } finally {
    window.clearTimeout(timeoutID)
  }
}

function formatPlaybackTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
