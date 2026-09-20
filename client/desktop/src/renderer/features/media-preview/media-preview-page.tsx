import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  RotateTopLeftIcon,
  RotateTopRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hugeicons/core-free-icons"
import { Copy, Gauge, FolderOpen, Pause, Play, Scan, Volume2, VolumeX } from "lucide-react"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { WindowTitleBar } from "@/components/window-title-bar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import type { MediaPreviewBridge, MediaPreviewPayload } from "../../../shared/media"

type Point = { x: number; y: number }

type VideoToolbarControls = {
  playing: boolean
  currentTime: number
  duration: number
  muted: boolean
  playbackRate: number
  zoom: number
  onTogglePlayback: () => void
  onSeek: (seconds: number) => void
  onToggleMute: () => void
  onPlaybackRateChange: (rate: number) => void
  onZoomOut: () => void
  onZoomIn: () => void
  onResetZoom: () => void
}

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function MediaPreviewPage() {
  const bridge = window.mediaPreview
  const [payload, setPayload] = useState<MediaPreviewPayload | null>(null)

  useEffect(() => {
    if (!bridge) return
    let cancelled = false
    void bridge.initialize().then((value) => {
      if (!cancelled) setPayload(value)
    })
    const unsubscribe = bridge.onChanged(setPayload)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    let theme: "light" | "dark" | "system" = "system"
    let changed = false
    let cancelled = false
    const update = () => {
      const dark = theme === "system" ? media.matches : theme === "dark"
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    const unsubscribe = bridge?.onThemeChanged((value) => {
      changed = true
      theme = value
      update()
    })
    update()
    void bridge
      ?.getTheme()
      .then((value) => {
        if (cancelled || changed) return
        theme = value
        update()
      })
      .catch(() => {})
    media.addEventListener("change", update)
    return () => {
      cancelled = true
      unsubscribe?.()
      media.removeEventListener("change", update)
    }
  }, [bridge])

  const windowTitle = `即应 Chat - ${payload?.title || "媒体预览"}`

  useEffect(() => {
    document.title = windowTitle
  }, [windowTitle])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <WindowTitleBar brandTitle={windowTitle} controls={bridge?.windowControls} />
      <main className="min-h-0 flex-1 overflow-hidden">
        {!payload ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载
          </div>
        ) : payload.category === "image" ? (
          <ImagePreview key={payload.resourceUrl} payload={payload} bridge={bridge} />
        ) : (
          <VideoPreview key={payload.resourceUrl} payload={payload} bridge={bridge} />
        )}
      </main>
    </div>
  )
}

function ImagePreview({
  payload,
  bridge,
}: {
  payload: MediaPreviewPayload
  bridge: MediaPreviewBridge | undefined
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const stopPanRef = useRef<(() => void) | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [rotatedFit, setRotatedFit] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const zoomRef = useRef(zoom)
  const rotationRef = useRef(rotation)
  zoomRef.current = zoom
  rotationRef.current = rotation

  useEffect(() => () => stopPanRef.current?.(), [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      setRotatedFit(rotationFitRatio(viewport, imageRef.current, rotationRef.current))
      setOffset((current) =>
        clampOffset(current, zoomRef.current, viewport, imageRef.current, rotationRef.current),
      )
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  function reset() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    stopPanRef.current?.()
    setDragging(false)
  }

  function rotate(degrees: -90 | 90) {
    const next = (rotation + degrees + 360) % 360
    setRotation(next)
    setRotatedFit(rotationFitRatio(viewportRef.current, imageRef.current, next))
    setOffset({ x: 0, y: 0 })
    stopPanRef.current?.()
    setDragging(false)
  }

  function changeZoom(percentage: number) {
    const nextZoom = Math.min(4, Math.max(0.25, percentage / 100))
    const viewport = viewportRef.current
    setOffset(
      viewport
        ? clampOffset(
            { x: (offset.x * nextZoom) / zoom, y: (offset.y * nextZoom) / zoom },
            nextZoom,
            viewport,
            imageRef.current,
            rotation,
          )
        : { x: 0, y: 0 },
    )
    setZoom(nextZoom)
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    const previousZoom = zoom
    const nextZoom = Math.min(4, Math.max(0.25, previousZoom * (event.deltaY < 0 ? 1.1 : 0.9)))
    const rect = viewport.getBoundingClientRect()
    const pointer = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    }
    setZoom(nextZoom)
    setOffset(
      clampOffset(
        {
          x: pointer.x - ((pointer.x - offset.x) * nextZoom) / previousZoom,
          y: pointer.y - ((pointer.y - offset.y) * nextZoom) / previousZoom,
        },
        nextZoom,
        viewport,
        imageRef.current,
        rotation,
      ),
    )
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || zoom <= 1) return
    event.preventDefault()
    stopPanRef.current?.()
    const viewport = event.currentTarget
    const origin = { x: event.clientX, y: event.clientY }
    const startingOffset = offset
    function stop() {
      stopPanRef.current?.()
      setDragging(false)
    }
    function move(pointer: MouseEvent) {
      if (!(pointer.buttons & 1)) {
        stop()
        return
      }
      setOffset(
        clampOffset(
          {
            x: startingOffset.x + pointer.clientX - origin.x,
            y: startingOffset.y + pointer.clientY - origin.y,
          },
          zoomRef.current,
          viewport,
          imageRef.current,
          rotationRef.current,
        ),
      )
    }
    stopPanRef.current = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", stop)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
      stopPanRef.current = null
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", stop)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    setDragging(true)
  }

  return (
    <PreviewToolbar
      bridge={bridge}
      category="image"
      zoom={Math.round(zoom * 100)}
      onZoomChange={changeZoom}
      onResetZoom={reset}
      onRotateLeft={() => rotate(-90)}
      onRotateRight={() => rotate(90)}
    >
      <div
        ref={viewportRef}
        className={`flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden bg-muted ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onDoubleClick={reset}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      >
        <img
          ref={imageRef}
          src={payload.resourceUrl}
          alt={payload.originalName || "图片预览"}
          draggable={false}
          className="max-h-full max-w-full object-contain will-change-transform"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom * rotatedFit})`,
          }}
          onLoad={() =>
            setRotatedFit(rotationFitRatio(viewportRef.current, imageRef.current, rotation))
          }
        />
      </div>
    </PreviewToolbar>
  )
}

function VideoPreview({
  payload,
  bridge,
}: {
  payload: MediaPreviewPayload
  bridge: MediaPreviewBridge | undefined
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopPanRef = useRef<(() => void) | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => () => stopPanRef.current?.(), [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      setOffset((current) => clampOffset(current, zoomRef.current, viewport, videoRef.current, 0))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  function changeZoom(percentage: number) {
    const nextZoom = Math.min(2, Math.max(0.5, percentage / 100))
    const viewport = viewportRef.current
    setOffset((current) =>
      viewport
        ? clampOffset(
            { x: (current.x * nextZoom) / zoom, y: (current.y * nextZoom) / zoom },
            nextZoom,
            viewport,
            videoRef.current,
            0,
          )
        : { x: 0, y: 0 },
    )
    setZoom(nextZoom)
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || zoom <= 1) return
    event.preventDefault()
    stopPanRef.current?.()
    const viewport = event.currentTarget
    const origin = { x: event.clientX, y: event.clientY }
    const startingOffset = offset
    function stop() {
      stopPanRef.current?.()
      setDragging(false)
    }
    function move(pointer: MouseEvent) {
      if (!(pointer.buttons & 1)) {
        stop()
        return
      }
      setOffset(
        clampOffset(
          {
            x: startingOffset.x + pointer.clientX - origin.x,
            y: startingOffset.y + pointer.clientY - origin.y,
          },
          zoomRef.current,
          viewport,
          videoRef.current,
          0,
        ),
      )
    }
    stopPanRef.current = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", stop)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("blur", stop)
      stopPanRef.current = null
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", stop)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("blur", stop)
    setDragging(true)
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  function seek(seconds: number) {
    const video = videoRef.current
    if (!video || !Number.isFinite(seconds)) return
    video.currentTime = Math.max(0, Math.min(duration, seconds))
    setCurrentTime(video.currentTime)
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  function changePlaybackRate(rate: number) {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    setPlaybackRate(rate)
  }

  const controls: VideoToolbarControls = {
    playing,
    currentTime,
    duration,
    muted,
    playbackRate,
    zoom: Math.round(zoom * 100),
    onTogglePlayback: togglePlayback,
    onSeek: seek,
    onToggleMute: toggleMute,
    onPlaybackRateChange: changePlaybackRate,
    onZoomOut: () => changeZoom(Math.round(zoom * 100) - 25),
    onZoomIn: () => changeZoom(Math.round(zoom * 100) + 25),
    onResetZoom: () => changeZoom(100),
  }

  return (
    <PreviewToolbar bridge={bridge} category="video" videoControls={controls}>
      <div
        ref={viewportRef}
        className={`flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden bg-muted ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={handleMouseDown}
      >
        <video
          ref={videoRef}
          src={payload.resourceUrl}
          className="max-h-full max-w-full bg-black object-contain will-change-transform"
          style={
            zoom === 1 && offset.x === 0 && offset.y === 0
              ? undefined
              : { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }
          }
          autoPlay
          playsInline
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration
            setDuration(Number.isFinite(nextDuration) ? nextDuration : 0)
          }}
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration
            setDuration(Number.isFinite(nextDuration) ? nextDuration : 0)
          }}
        />
      </div>
    </PreviewToolbar>
  )
}

function PreviewToolbar({
  children,
  bridge,
  category,
  zoom,
  onZoomChange,
  onResetZoom,
  onRotateLeft,
  onRotateRight,
  videoControls,
}: {
  children: ReactNode
  bridge: MediaPreviewBridge | undefined
  category: "image" | "video"
  zoom?: number
  onZoomChange?: (percentage: number) => void
  onResetZoom?: () => void
  onRotateLeft?: () => void
  onRotateRight?: () => void
  videoControls?: VideoToolbarControls
}) {
  const [busy, setBusy] = useState<"folder" | "copy" | null>(null)
  const { showToast } = useAnimatedToast()
  const stopDragRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDragRef.current?.(), [])

  async function run(action: "folder" | "copy") {
    if (!bridge || busy) return
    setBusy(action)
    try {
      const result =
        action === "folder" ? await bridge.revealCurrent() : await bridge.copyCurrentImage()
      if (!result.ok) throw new Error(result.error.message)
      showToast({
        status: "success",
        title: action === "folder" ? "已打开文件所在文件夹" : "图片已复制",
      })
    } catch (error) {
      showToast({ status: "error", title: error instanceof Error ? error.message : "操作失败" })
    } finally {
      setBusy(null)
    }
  }

  const zoomOut = () => {
    if (zoom !== undefined) onZoomChange?.(Math.max(25, Math.round(zoom / 1.1)))
  }
  const zoomIn = () => {
    if (zoom !== undefined) onZoomChange?.(Math.min(400, Math.round(zoom * 1.1)))
  }
  const menuItemClassName =
    "transition-colors duration-150 hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          {category === "image" && zoom !== undefined && onZoomChange && (
            <>
              <ContextMenuItem
                className={menuItemClassName}
                disabled={zoom <= 25}
                onSelect={zoomOut}
              >
                <HugeiconsIcon icon={ZoomOutIcon} aria-hidden className="size-4" />
                缩小图片
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClassName}
                disabled={zoom >= 400}
                onSelect={zoomIn}
              >
                <HugeiconsIcon icon={ZoomInIcon} aria-hidden className="size-4" />
                放大图片
              </ContextMenuItem>
              <ContextMenuItem className={menuItemClassName} onSelect={onResetZoom}>
                <Scan aria-hidden className="size-4" />
                恢复 100%
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className={menuItemClassName} onSelect={onRotateLeft}>
                <HugeiconsIcon icon={RotateTopLeftIcon} aria-hidden className="size-4" />
                向左旋转 90 度
              </ContextMenuItem>
              <ContextMenuItem className={menuItemClassName} onSelect={onRotateRight}>
                <HugeiconsIcon icon={RotateTopRightIcon} aria-hidden className="size-4" />
                向右旋转 90 度
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {category === "video" && videoControls && (
            <>
              <ContextMenuItem
                className={menuItemClassName}
                onSelect={videoControls.onTogglePlayback}
              >
                {videoControls.playing ? (
                  <Pause aria-hidden className="size-4" />
                ) : (
                  <Play aria-hidden className="size-4" />
                )}
                {videoControls.playing ? "暂停" : "播放"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={menuItemClassName}
                disabled={videoControls.zoom <= 50}
                onSelect={videoControls.onZoomOut}
              >
                <HugeiconsIcon icon={ZoomOutIcon} aria-hidden className="size-4" />
                缩小视频
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClassName}
                disabled={videoControls.zoom >= 200}
                onSelect={videoControls.onZoomIn}
              >
                <HugeiconsIcon icon={ZoomInIcon} aria-hidden className="size-4" />
                放大视频
              </ContextMenuItem>
              <ContextMenuItem className={menuItemClassName} onSelect={videoControls.onResetZoom}>
                <Scan aria-hidden className="size-4" />
                恢复 100%
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className={menuItemClassName} onSelect={videoControls.onToggleMute}>
                {videoControls.muted ? (
                  <VolumeX aria-hidden className="size-4" />
                ) : (
                  <Volume2 aria-hidden className="size-4" />
                )}
                {videoControls.muted ? "开启声音" : "关闭声音"}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger className={menuItemClassName}>
                  <Gauge aria-hidden className="size-4" />
                  播放速度
                  <span className="ml-auto text-xs text-muted-foreground">
                    {videoControls.playbackRate} 倍速
                  </span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuRadioGroup
                    value={String(videoControls.playbackRate)}
                    onValueChange={(value) => videoControls.onPlaybackRateChange(Number(value))}
                  >
                    {playbackRates.map((rate) => (
                      <ContextMenuRadioItem
                        key={rate}
                        value={String(rate)}
                        className={menuItemClassName}
                      >
                        {rate} 倍速
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            className={menuItemClassName}
            disabled={!bridge || busy !== null}
            onSelect={() => void run("folder")}
          >
            <FolderOpen aria-hidden className="size-4" />
            打开文件夹
          </ContextMenuItem>
          {category === "image" && (
            <ContextMenuItem
              className={menuItemClassName}
              disabled={!bridge || busy !== null}
              onSelect={() => void run("copy")}
            >
              <Copy aria-hidden className="size-4" />
              复制图片
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <footer className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2 text-foreground">
        {category === "video" && videoControls && (
          <div className="flex min-w-80 flex-1 items-center gap-2">
            <button
              type="button"
              title={videoControls.playing ? "暂停" : "播放"}
              aria-label={videoControls.playing ? "暂停" : "播放"}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={videoControls.onTogglePlayback}
            >
              {videoControls.playing ? (
                <Pause aria-hidden className="size-4" />
              ) : (
                <Play aria-hidden className="size-4" />
              )}
            </button>
            <Slider
              aria-label="视频播放进度"
              min={0}
              max={Math.max(1, videoControls.duration)}
              step={0.1}
              value={[Math.min(videoControls.currentTime, Math.max(1, videoControls.duration))]}
              disabled={videoControls.duration <= 0}
              onValueChange={([value]) => {
                if (value !== undefined) videoControls.onSeek(value)
              }}
              onPointerDownCapture={(event) =>
                startHorizontalSliderDrag(
                  event,
                  0,
                  Math.max(1, videoControls.duration),
                  videoControls.onSeek,
                  stopDragRef,
                )
              }
            />
            <span className="w-24 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
              {formatVideoTime(videoControls.currentTime)} /{" "}
              {formatVideoTime(videoControls.duration)}
            </span>
            <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
            <button
              type="button"
              title={videoControls.muted ? "开启声音" : "关闭声音"}
              aria-label={videoControls.muted ? "开启声音" : "关闭声音"}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={videoControls.onToggleMute}
            >
              {videoControls.muted ? (
                <VolumeX aria-hidden className="size-4" />
              ) : (
                <Volume2 aria-hidden className="size-4" />
              )}
            </button>
            <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="播放速度"
                  aria-label={`${videoControls.playbackRate} 倍速`}
                  className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {videoControls.playbackRate} 倍速
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-28">
                <DropdownMenuRadioGroup
                  value={String(videoControls.playbackRate)}
                  onValueChange={(value) => videoControls.onPlaybackRateChange(Number(value))}
                >
                  {playbackRates.map((rate) => (
                    <DropdownMenuRadioItem
                      key={rate}
                      value={String(rate)}
                      className={menuItemClassName}
                    >
                      {rate} 倍速
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {category === "image" && zoom !== undefined && onZoomChange && (
          <div className="flex min-w-48 flex-1 items-center gap-3 sm:max-w-xs">
            <button
              type="button"
              title="缩小图片"
              aria-label="缩小图片"
              disabled={zoom <= 25}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              onClick={zoomOut}
            >
              <HugeiconsIcon icon={ZoomOutIcon} aria-hidden className="size-4" />
            </button>
            <Slider
              aria-label="图片缩放比例"
              min={25}
              max={400}
              step={1}
              value={[zoom]}
              onValueChange={([value]) => {
                if (value !== undefined) onZoomChange(value)
              }}
              onPointerDownCapture={(event) =>
                startHorizontalSliderDrag(event, 25, 400, onZoomChange, stopDragRef)
              }
            />
            <button
              type="button"
              title="放大图片"
              aria-label="放大图片"
              disabled={zoom >= 400}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              onClick={zoomIn}
            >
              <HugeiconsIcon icon={ZoomInIcon} aria-hidden className="size-4" />
            </button>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums">{zoom}%</span>
            <button
              type="button"
              title="恢复 100%"
              aria-label="恢复 100%"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={onResetZoom}
            >
              <Scan aria-hidden className="size-4" />
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {category === "video" && videoControls && (
            <>
              <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
              <button
                type="button"
                title="缩小视频"
                aria-label="缩小视频"
                disabled={videoControls.zoom <= 50}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                onClick={videoControls.onZoomOut}
              >
                <HugeiconsIcon icon={ZoomOutIcon} aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                title="放大视频"
                aria-label="放大视频"
                disabled={videoControls.zoom >= 200}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                onClick={videoControls.onZoomIn}
              >
                <HugeiconsIcon icon={ZoomInIcon} aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                title="恢复 100%"
                aria-label="恢复 100%"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={videoControls.onResetZoom}
              >
                <Scan aria-hidden className="size-4" />
              </button>
              <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
            </>
          )}
          {category === "image" && (
            <>
              <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
              <button
                type="button"
                title="向左旋转 90 度"
                aria-label="向左旋转 90 度"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={onRotateLeft}
              >
                <HugeiconsIcon icon={RotateTopLeftIcon} aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                title="向右旋转 90 度"
                aria-label="向右旋转 90 度"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={onRotateRight}
              >
                <HugeiconsIcon icon={RotateTopRightIcon} aria-hidden className="size-4" />
              </button>
            </>
          )}
          {category === "image" && (
            <span className="mx-1 h-5 shrink-0 border-l border-border" aria-hidden />
          )}
          <button
            type="button"
            title="打开文件夹"
            aria-label="打开文件夹"
            disabled={!bridge || busy !== null}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            onClick={() => void run("folder")}
          >
            <FolderOpen aria-hidden className="size-4" />
          </button>
          {category === "image" && (
            <button
              type="button"
              title="复制图片"
              aria-label="复制图片"
              disabled={!bridge || busy !== null}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              onClick={() => void run("copy")}
            >
              <Copy aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

function startHorizontalSliderDrag(
  event: ReactPointerEvent<HTMLElement>,
  min: number,
  max: number,
  onValueChange: ((value: number) => void) | undefined,
  stopRef: { current: (() => void) | null },
) {
  if (event.button !== 0 || max <= min || !onValueChange) return
  // WSLg can change the pointer ID/type after mouse down; its mouse stream stays stable.
  const slider = event.currentTarget
  stopRef.current?.()
  function stop() {
    stopRef.current?.()
  }
  function update(move: MouseEvent) {
    if (!(move.buttons & 1)) {
      stop()
      return
    }
    const { left, width } = slider.getBoundingClientRect()
    if (!width) return
    onValueChange?.(
      Math.max(min, Math.min(max, min + ((move.clientX - left) / width) * (max - min))),
    )
  }
  stopRef.current = () => {
    window.removeEventListener("mousemove", update)
    window.removeEventListener("mouseup", stop)
    window.removeEventListener("pointerup", stop)
    window.removeEventListener("pointercancel", stop)
    window.removeEventListener("blur", stop)
    stopRef.current = null
  }
  window.addEventListener("mousemove", update)
  window.addEventListener("mouseup", stop)
  window.addEventListener("pointerup", stop)
  window.addEventListener("pointercancel", stop)
  window.addEventListener("blur", stop)
}

function formatVideoTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, "0")
  if (minutes < 60) return `${minutes}:${remainder}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`
}

function rotationFitRatio(
  viewport: HTMLElement | null,
  image: HTMLImageElement | null,
  rotation: number,
): number {
  if (!viewport || !image || rotation % 180 === 0 || !image.naturalWidth || !image.naturalHeight)
    return 1
  const { width, height } = viewport.getBoundingClientRect()
  if (!width || !height) return 1
  const originalFit = Math.min(1, width / image.naturalWidth, height / image.naturalHeight)
  const rotatedFit = Math.min(1, width / image.naturalHeight, height / image.naturalWidth)
  return rotatedFit / originalFit
}

function clampOffset(
  value: Point,
  zoom: number,
  viewport: HTMLElement,
  media: HTMLImageElement | HTMLVideoElement | null,
  rotation: number,
): Point {
  if (!media) return value
  const viewportRect = viewport.getBoundingClientRect()
  const naturalWidth =
    (media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth) ||
    viewportRect.width
  const naturalHeight =
    (media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight) ||
    viewportRect.height
  const rotated = rotation % 180 !== 0
  const visibleWidth = rotated ? naturalHeight : naturalWidth
  const visibleHeight = rotated ? naturalWidth : naturalHeight
  const fit = Math.min(1, viewportRect.width / visibleWidth, viewportRect.height / visibleHeight)
  const width = visibleWidth * fit * zoom
  const height = visibleHeight * fit * zoom
  const maximumX = Math.max(0, (width - viewportRect.width) / 2)
  const maximumY = Math.max(0, (height - viewportRect.height) / 2)
  return {
    x: Math.min(maximumX, Math.max(-maximumX, value.x)),
    y: Math.min(maximumY, Math.max(-maximumY, value.y)),
  }
}
