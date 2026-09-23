import { useContext, useRef, useState } from "react"
import {
  DocumentAttachmentIcon,
  Download01Icon,
  Folder02Icon,
  ImageNotFound01Icon,
  Loading03Icon,
  PauseCircleIcon,
  PlayCircle02Icon,
  Volume02Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCachedMedia } from "../use-cached-media"
import { MediaContext } from "./context"
import { MarkdownBody, TextBody } from "./text-body"
import { formatFileSize, imageThumbnailFrame, mediaUrl, progressPercentage } from "./utils"

export function ImageBody({
  body,
  targetId,
  flush,
}: {
  body: Extract<DesktopMessageBody, { type: "image" }>
  targetId: string
  flush: boolean
}) {
  const { conversationName } = useContext(MediaContext)
  const [imageFailed, setImageFailed] = useState(false)
  const media = useCachedMedia({ targetId, fileId: body.fileId, category: "image" }, true)
  const frame = imageThumbnailFrame(body.width, body.height)
  const failed = imageFailed || media.status === "failed"

  async function openPreview() {
    const cached = media.cached ?? (await media.ensureCached())
    if (!cached) return
    await window.desktop?.media.openPreview({
      targetId,
      cacheKey: cached.cacheKey,
      conversationName,
    })
  }

  return (
    <div className="max-w-[65vw] min-w-0" style={{ width: frame.width }}>
      <button
        type="button"
        className="relative block max-w-[65vw] overflow-hidden bg-muted text-left"
        style={frame}
        aria-label="预览图片"
        disabled={!media.cached || failed}
        onClick={() => void openPreview()}
      >
        {failed ? (
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={ImageNotFound01Icon} className="size-5" aria-hidden />
            图片加载失败
          </span>
        ) : media.cached ? (
          <img
            src={media.cached.resourceUrl}
            alt={body.caption || "图片消息"}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ImageLoadingOverlay />
        )}
      </button>
      <MediaCaption body={body} flush={flush} />
    </div>
  )
}

export function VideoBody({
  body,
  targetId,
  flush,
}: {
  body: Extract<DesktopMessageBody, { type: "video" }>
  targetId: string
  flush: boolean
}) {
  const { conversationName } = useContext(MediaContext)
  const media = useCachedMedia(
    {
      targetId,
      fileId: body.fileId,
      category: "video",
      originalName: body.name,
      contentType: body.contentType,
      expectedSizeBytes: body.sizeBytes || undefined,
    },
    false,
  )
  const downloading = media.status === "downloading" || media.status === "verifying"

  async function downloadAndOpen() {
    const cached = media.cached ?? (await media.ensureCached())
    if (!cached) return
    await window.desktop?.media.openPreview({
      targetId,
      cacheKey: cached.cacheKey,
      conversationName,
    })
  }

  return (
    <div className="w-64 max-w-[65vw] min-w-0">
      <button
        type="button"
        className="group relative flex aspect-video w-64 max-w-full items-center justify-center overflow-hidden bg-foreground"
        aria-label={media.cached ? "播放视频" : "下载并播放视频"}
        disabled={downloading}
        onClick={() => void downloadAndOpen()}
      >
        <HugeiconsIcon
          icon={PlayCircle02Icon}
          className="size-10 text-background transition-colors group-hover:text-xgui-brand-4"
          strokeWidth={1}
          aria-hidden
        />
        {downloading && (
          <MediaProgressOverlay
            downloadedBytes={media.downloadedBytes}
            totalBytes={media.totalBytes}
          />
        )}
      </button>
      <MediaCaption body={body} flush={flush} />
    </div>
  )
}

export function VoiceBody({
  body,
  targetId,
}: {
  body: Extract<DesktopMessageBody, { type: "voice" }>
  targetId: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle")
  const [elapsedMS, setElapsedMS] = useState(0)
  const loading = state === "loading"
  const playing = state === "playing"
  const displayedDuration = state === "idle" ? body.durationMS : elapsedMS

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || loading) return
    if (playing) {
      audio.pause()
      setState("paused")
      return
    }
    setState("loading")
    try {
      await audio.play()
    } catch {
      setState("idle")
      setElapsedMS(0)
    }
  }

  return (
    <div className="flex w-80 max-w-full items-center gap-3">
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        src={mediaUrl(targetId, body.fileId)}
        onPlaying={() => setState("playing")}
        onWaiting={() => setState("loading")}
        onPause={() => setState((current) => (current === "idle" ? current : "paused"))}
        onTimeUpdate={(event) => setElapsedMS(event.currentTarget.currentTime * 1000)}
        onEnded={() => {
          setState("idle")
          setElapsedMS(0)
        }}
        onError={() => {
          setState("idle")
          setElapsedMS(0)
        }}
      />
      <HugeiconsIcon
        icon={Volume02Icon}
        className="size-7 shrink-0 text-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">语音 - {formatPlaybackTime(displayedDuration)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {body.transcript || "暂无文字摘要"}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 hover:bg-foreground/5"
        disabled={loading}
        aria-label={loading ? "正在加载语音" : playing ? "暂停语音" : "播放语音"}
        title={loading ? "正在加载" : playing ? "暂停" : "播放"}
        onClick={() => void togglePlayback()}
      >
        <HugeiconsIcon
          icon={loading ? Loading03Icon : playing ? PauseCircleIcon : PlayCircle02Icon}
          className={cn("size-4 group-hover/bubble:text-xgui-brand-5", loading && "animate-spin")}
          strokeWidth={1.5}
          aria-hidden
        />
      </Button>
    </div>
  )
}

export function FileBody({ body }: { body: Extract<DesktopMessageBody, { type: "file" }> }) {
  const { targetId } = useContext(MediaContext)
  const media = useCachedMedia(
    {
      targetId,
      fileId: body.fileId,
      category: "attachment",
      originalName: body.name,
      expectedSizeBytes: body.sizeBytes || undefined,
    },
    false,
  )
  const downloading = media.status === "downloading" || media.status === "verifying"

  async function revealCached() {
    if (!media.cached || !window.desktop) return
    await window.desktop.media.revealCached({ targetId, cacheKey: media.cached.cacheKey })
  }

  return (
    <div className="relative flex w-80 max-w-full items-center gap-3 overflow-hidden text-left">
      <HugeiconsIcon
        icon={DocumentAttachmentIcon}
        className="size-7 shrink-0 text-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{body.name}</div>
        <div className="text-xs text-muted-foreground">
          {downloading
            ? `下载中 · ${formatFileSize(media.downloadedBytes)}`
            : formatFileSize(body.sizeBytes)}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 hover:bg-foreground/5"
        disabled={downloading}
        aria-label={media.cached ? "打开文件所在文件夹" : downloading ? "正在下载文件" : "下载文件"}
        title={media.cached ? "打开文件所在文件夹" : downloading ? "正在下载" : "下载文件"}
        onClick={() => void (media.cached ? revealCached() : media.ensureCached())}
      >
        <HugeiconsIcon
          icon={media.cached ? Folder02Icon : downloading ? Loading03Icon : Download01Icon}
          className={cn(
            "size-4 group-hover/bubble:text-xgui-brand-5",
            downloading && "animate-spin",
          )}
          aria-hidden
        />
      </Button>
    </div>
  )
}

function formatPlaybackTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function MediaCaption({
  body,
  flush,
}: {
  body: Extract<DesktopMessageBody, { type: "image" | "video" }>
  flush: boolean
}) {
  if (!body.caption) return null
  return (
    <div className={cn("min-w-0 pt-2", flush && "px-3 pb-3")}>
      {body.captionType === "markdown" ? (
        <MarkdownBody content={body.caption} />
      ) : (
        <TextBody content={body.caption} />
      )}
    </div>
  )
}

function ImageLoadingOverlay() {
  return (
    <span
      className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
      aria-label="图片加载中"
    >
      <HugeiconsIcon icon={Loading03Icon} className="size-6 animate-spin" aria-hidden />
    </span>
  )
}

function MediaProgressOverlay({
  downloadedBytes,
  totalBytes,
}: {
  downloadedBytes: number
  totalBytes?: number
}) {
  const percentage = progressPercentage(downloadedBytes, totalBytes)
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-xs text-white">
      {percentage === undefined ? "下载中" : `${percentage}%`}
      <span className="absolute right-0 bottom-0 left-0 h-1 bg-white/25">
        <span
          className={cn(
            "block h-full bg-xgui-brand transition-[width]",
            percentage === undefined && "w-1/3 animate-pulse",
          )}
          style={percentage === undefined ? undefined : { width: `${percentage}%` }}
        />
      </span>
    </span>
  )
}
