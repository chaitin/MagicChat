import { useContext, useState } from "react"
import { File01Icon, ImageNotFound01Icon, PlayIcon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { cn } from "@/lib/utils"
import { useCachedMedia } from "../use-cached-media"
import { MediaContext } from "./context"
import { MarkdownBody, TextBody } from "./text-body"
import {
  formatDuration,
  formatFileSize,
  imageThumbnailFrame,
  mediaUrl,
  progressPercentage,
  progressWidth,
} from "./utils"

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
          icon={PlayIcon}
          className="size-10 text-background transition-colors group-hover:text-xgui-brand-4"
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
  return (
    <div className="grid w-72 max-w-full gap-2">
      <audio
        controls
        preload="metadata"
        className="h-9 w-full"
        src={mediaUrl(targetId, body.fileId)}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDuration(body.durationMS)}</span>
        <span>{formatFileSize(body.sizeBytes)}</span>
      </div>
      {body.transcript && <p className="text-sm text-muted-foreground">{body.transcript}</p>}
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
  return (
    <button
      type="button"
      className="relative flex w-80 max-w-full items-center gap-3 overflow-hidden text-left"
      disabled={downloading}
      onClick={() => void media.ensureCached()}
    >
      <HugeiconsIcon
        icon={File01Icon}
        className="size-6 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{body.name}</div>
        <div className="text-xs text-muted-foreground">
          {media.status === "ready"
            ? `已缓存 · ${formatFileSize(body.sizeBytes)}`
            : downloading
              ? `下载中 · ${formatFileSize(media.downloadedBytes)}`
              : formatFileSize(body.sizeBytes)}
        </div>
      </div>
      {downloading && (
        <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-foreground/10">
          <span
            className="block h-full bg-xgui-brand transition-[width]"
            style={{ width: progressWidth(media.downloadedBytes, media.totalBytes) }}
          />
        </span>
      )}
    </button>
  )
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
