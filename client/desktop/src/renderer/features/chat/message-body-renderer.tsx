import { createContext, useContext, useState } from "react"
import {
  File01Icon,
  ImageNotFound01Icon,
  Link01Icon,
  MessageMultiple02Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
} from "recharts"
import type { DesktopMessageBody } from "../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { MessageMarkdown } from "@/components/message-markdown"
import {
  mentionClassName,
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { CollapsibleMessageContent } from "./collapsible-message-content"
import { useCachedMedia } from "./use-cached-media"

const MediaContext = createContext({ targetId: "", conversationName: "" })

const MentionContext = createContext<{
  currentUserId: string
  resolveLabel: MentionLabelResolver
}>({ currentUserId: "", resolveLabel: () => undefined })

export function MessageBodyRenderer({
  body,
  targetId,
  currentUserId,
  mentionLabelResolver,
  conversationName,
  flushMedia = false,
}: {
  body: DesktopMessageBody
  targetId: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  conversationName: string
  flushMedia?: boolean
}) {
  return (
    <MediaContext.Provider value={{ targetId, conversationName }}>
      <MentionContext.Provider value={{ currentUserId, resolveLabel: mentionLabelResolver }}>
        <MessageBodyContent
          body={body}
          targetId={targetId}
          flushMedia={flushMedia}
          collapseLongContent
        />
      </MentionContext.Provider>
    </MediaContext.Provider>
  )
}

function MessageBodyContent({
  body,
  targetId,
  flushMedia = false,
  collapseLongContent = false,
}: {
  body: DesktopMessageBody
  targetId: string
  flushMedia?: boolean
  collapseLongContent?: boolean
}) {
  switch (body.type) {
    case "text":
      return collapseLongContent ? (
        <CollapsibleMessageContent variant="text">
          <TextBody content={body.content} />
        </CollapsibleMessageContent>
      ) : (
        <TextBody content={body.content} />
      )
    case "markdown":
      return collapseLongContent ? (
        <CollapsibleMessageContent variant="markdown">
          <MarkdownBody content={body.content} />
        </CollapsibleMessageContent>
      ) : (
        <MarkdownBody content={body.content} />
      )
    case "image":
      return <ImageBody body={body} targetId={targetId} flush={flushMedia} />
    case "video":
      return <VideoBody body={body} targetId={targetId} flush={flushMedia} />
    case "file":
      return <FileBody body={body} />
    case "voice":
      return <VoiceBody body={body} targetId={targetId} />
    case "link":
      return <LinkBody title={body.title} url={body.url} />
    case "card":
      return <CardBody title={body.title} description={body.description} url={body.url} />
    case "chart":
      return <ChartBody body={body} />
    case "choice":
      return <ChoiceBody body={body} />
    case "forward_bundle":
      return <ForwardBundleBody body={body} targetId={targetId} />
    case "system_event":
      return <span>{body.summary}</span>
    case "revoked":
      return <span className="text-muted-foreground">该消息已被撤回</span>
    case "unsupported":
      return <span className="text-muted-foreground">暂不支持查看该消息</span>
  }
}

function TextBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <span className="break-all whitespace-pre-wrap">
      {parseMentionTemplate(content, resolveLabel).map((part, index) =>
        part.type === "text" ? (
          part.text
        ) : (
          <span
            key={`${part.id}-${index}`}
            className={mentionClassName(part.targetType, part.id, currentUserId)}
          >
            {part.label}
          </span>
        ),
      )}
    </span>
  )
}

function MarkdownBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <MessageMarkdown
      content={content}
      currentUserId={currentUserId}
      mentionLabelResolver={resolveLabel}
    />
  )
}

function ImageBody({
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
      {body.caption && (
        <div className={cn("min-w-0 pt-2", flush && "px-3 pb-3")}>
          {body.captionType === "markdown" ? (
            <MarkdownBody content={body.caption} />
          ) : (
            <TextBody content={body.caption} />
          )}
        </div>
      )}
    </div>
  )
}

function VideoBody({
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
      {body.caption && (
        <div className={cn("min-w-0 pt-2", flush && "px-3 pb-3")}>
          {body.captionType === "markdown" ? (
            <MarkdownBody content={body.caption} />
          ) : (
            <TextBody content={body.caption} />
          )}
        </div>
      )}
    </div>
  )
}

function VoiceBody({
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

function FileBody({ body }: { body: Extract<DesktopMessageBody, { type: "file" }> }) {
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

function LinkBody({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex w-80 max-w-full items-start gap-3">
      <HugeiconsIcon
        icon={Link01Icon}
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="line-clamp-2 font-medium">{title}</div>
        <div className="truncate text-xs text-xgui-link">{url}</div>
      </div>
    </div>
  )
}

function CardBody({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  return (
    <div className="grid w-80 max-w-full gap-2">
      <div className="font-medium">{title}</div>
      <div className="line-clamp-3 text-muted-foreground">{description}</div>
      <div className="truncate text-xs text-xgui-link">{url}</div>
    </div>
  )
}

function ChoiceBody({ body }: { body: Extract<DesktopMessageBody, { type: "choice" }> }) {
  return (
    <div className="grid w-80 max-w-full gap-3">
      {body.contentType === "markdown" ? (
        <MarkdownBody content={body.content} />
      ) : (
        <TextBody content={body.content} />
      )}
      <div className="grid gap-2">
        {body.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-left disabled:opacity-70"
          >
            <span
              className={cn(
                "size-3.5 shrink-0 border",
                body.selection === "single" ? "rounded-full" : "rounded-sm",
              )}
            />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ForwardBundleBody({
  body,
  targetId,
}: {
  body: Extract<DesktopMessageBody, { type: "forward_bundle" }>
  targetId: string
}) {
  return (
    <details className="w-96 max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <HugeiconsIcon icon={MessageMultiple02Icon} className="size-4" aria-hidden />
        聊天记录（{body.itemCount}）
      </summary>
      <div className="mt-3 grid max-h-80 gap-3 overflow-y-auto border-t pt-3">
        {body.items.map((item, index) => (
          <div key={`${item.sentAt}-${index}`} className="grid gap-1 border-b pb-3 last:border-0">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{item.senderName}</span>
              <span className="shrink-0">{formatDateTime(item.sentAt)}</span>
            </div>
            <MessageBodyContent body={item.body} targetId={targetId} collapseLongContent={false} />
          </div>
        ))}
      </div>
    </details>
  )
}

function ChartBody({ body }: { body: Extract<DesktopMessageBody, { type: "chart" }> }) {
  const data = chartData(body)
  return (
    <div className="grid h-72 w-[30rem] max-w-full grid-rows-[auto_1fr] gap-3">
      <div>
        <div className="font-medium">{body.title}</div>
        {body.description && (
          <div className="text-xs text-muted-foreground">{body.description}</div>
        )}
      </div>
      {data ? (
        <ResponsiveContainer>{data}</ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center text-muted-foreground">
          暂不支持查看该图表
        </div>
      )}
    </div>
  )
}

function chartData(body: Extract<DesktopMessageBody, { type: "chart" }>) {
  const data = record(body.data)
  if (!data) return null
  if (
    (body.chartType === "line" || body.chartType === "bar") &&
    Array.isArray(data.labels) &&
    Array.isArray(data.series)
  ) {
    const series = data.series.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && Array.isArray(item.values)
        ? [{ name: item.name, values: item.values }]
        : []
    })
    const rows = data.labels.map((label, index) =>
      Object.fromEntries([
        ["name", String(label)],
        ...series.map((item) => [item.name, item.values[index] ?? null]),
      ]),
    )
    if (body.chartType === "line") {
      return (
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          {series.map((item, index) => (
            <Line
              key={item.name}
              dataKey={item.name}
              stroke={chartColors[index % chartColors.length]}
            />
          ))}
        </LineChart>
      )
    }
    return (
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        {series.map((item, index) => (
          <Bar key={item.name} dataKey={item.name} fill={chartColors[index % chartColors.length]} />
        ))}
      </BarChart>
    )
  }
  if (body.chartType === "pie" && Array.isArray(data.items)) {
    const items = data.items.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && typeof item.value === "number"
        ? [{ name: item.name, value: item.value }]
        : []
    })
    return (
      <PieChart>
        <Tooltip />
        <Pie data={items} dataKey="value" nameKey="name" outerRadius="80%">
          {items.map((_, index) => (
            <Cell key={index} fill={chartColors[index % chartColors.length]} />
          ))}
        </Pie>
      </PieChart>
    )
  }
  if (body.chartType === "radar" && Array.isArray(data.axes) && Array.isArray(data.series)) {
    const axes = data.axes.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" ? [{ name: item.name }] : []
    })
    const series = data.series.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && Array.isArray(item.values)
        ? [{ name: item.name, values: item.values }]
        : []
    })
    const rows = axes.map((axis, index) =>
      Object.fromEntries([
        ["name", axis.name],
        ...series.map((item) => [item.name, item.values[index] ?? 0]),
      ]),
    )
    return (
      <RadarChart data={rows}>
        <PolarGrid />
        <PolarAngleAxis dataKey="name" />
        <PolarRadiusAxis />
        {series.map((item, index) => (
          <Radar
            key={item.name}
            dataKey={item.name}
            stroke={chartColors[index % chartColors.length]}
            fill={chartColors[index % chartColors.length]}
            fillOpacity={0.18}
          />
        ))}
      </RadarChart>
    )
  }
  return null
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

function progressPercentage(downloadedBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) return undefined
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
}

function progressWidth(downloadedBytes: number, totalBytes?: number) {
  const percentage = progressPercentage(downloadedBytes, totalBytes)
  return percentage === undefined ? "33%" : `${percentage}%`
}

function mediaUrl(targetId: string, fileId: string) {
  return `jiying-media://file/${encodeURIComponent(targetId)}/${encodeURIComponent(fileId)}`
}

function imageThumbnailFrame(width?: number, height?: number) {
  if (!width || !height) return { width: 256, height: 256 }
  const thumbnailWidth = Math.min(320, Math.max(160, width))
  return {
    width: thumbnailWidth,
    height: Math.max(1, Math.round(Math.min(360, (height * thumbnailWidth) / width))),
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const chartColors = ["#07c160", "#576b95", "#fa9d3b", "#fa5151", "#10aeff"]
