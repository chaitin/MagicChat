import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react"
import { Minus, Plus, RotateCcw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

type Point = { x: number; y: number }
type ImageSize = { width: number; height: number }
type ImageLayout = { width: number; height: number }

const outputSize = 256
const maxSourceBytes = 5 * 1024 * 1024
const maxOutputBytes = 1024 * 1024

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function imageLayout(image: ImageSize, zoom: number, frameSize: number): ImageLayout {
  const scale = (frameSize / Math.min(image.width, image.height)) * zoom
  return { width: image.width * scale, height: image.height * scale }
}

function clampOffset(offset: Point, layout: ImageLayout, frameSize: number): Point {
  return {
    x: clamp(offset.x, frameSize - layout.width, 0),
    y: clamp(offset.y, frameSize - layout.height, 0),
  }
}

export function GroupAvatarPicker({
  formId,
  onReadyChange,
  onSave,
  saving,
}: {
  formId: string
  onReadyChange: (ready: boolean) => void
  onSave: (bytes: ArrayBuffer) => Promise<void>
  saving: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ pointer: Point; offset: Point } | null>(null)
  const previousFrameSize = useRef(outputSize)
  const activeRef = useRef(true)
  const [frameSize, setFrameSize] = useState(outputSize)
  const [sourceUrl, setSourceUrl] = useState("")
  const [imageSize, setImageSize] = useState<ImageSize | null>(null)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState("")
  const layout = imageSize ? imageLayout(imageSize, zoom, frameSize) : null
  const disabled = saving || processing
  const ready = Boolean(layout) && !disabled

  useEffect(() => {
    onReadyChange(ready)
  }, [onReadyChange, ready])

  useEffect(() => () => onReadyChange(false), [onReadyChange])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  useEffect(() => {
    if (sourceUrl) return () => URL.revokeObjectURL(sourceUrl)
  }, [sourceUrl])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const updateSize = () => {
      const width = frame.getBoundingClientRect().width
      if (width > 0) setFrameSize(width)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const previous = previousFrameSize.current
    if (previous === frameSize) return
    previousFrameSize.current = frameSize
    if (!imageSize) return
    const nextLayout = imageLayout(imageSize, zoom, frameSize)
    const ratio = frameSize / previous
    setOffset((current) =>
      clampOffset({ x: current.x * ratio, y: current.y * ratio }, nextLayout, frameSize),
    )
  }, [frameSize, imageSize, zoom])

  function resetImage() {
    setSourceUrl("")
    setImageSize(null)
    setOffset({ x: 0, y: 0 })
    setZoom(1)
    setDragging(false)
    dragRef.current = null
  }

  function chooseFile(file: File | undefined) {
    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      resetImage()
      setError("请选择 PNG、JPG 或 WebP 图片")
      return
    }
    if (file.size === 0 || file.size > maxSourceBytes) {
      resetImage()
      setError("图片文件不能超过 5MiB")
      return
    }
    resetImage()
    setError("")
    setSourceUrl(URL.createObjectURL(file))
  }

  function loadImage(image: HTMLImageElement) {
    const size = { width: image.naturalWidth, height: image.naturalHeight }
    if (size.width < 64 || size.height < 64 || size.width > 4096 || size.height > 4096) {
      resetImage()
      setError("图片尺寸须在 64×64 至 4096×4096 之间")
      return
    }
    const nextLayout = imageLayout(size, 1, frameSize)
    setImageSize(size)
    setOffset({
      x: (frameSize - nextLayout.width) / 2,
      y: (frameSize - nextLayout.height) / 2,
    })
  }

  function changeZoom(value: number) {
    if (!imageSize || !layout) return
    const nextZoom = clamp(value, 1, 3)
    const nextLayout = imageLayout(imageSize, nextZoom, frameSize)
    const center = frameSize / 2
    setOffset((current) =>
      clampOffset(
        {
          x: center - ((center - current.x) / layout.width) * nextLayout.width,
          y: center - ((center - current.y) / layout.height) * nextLayout.height,
        },
        nextLayout,
        frameSize,
      ),
    )
    setZoom(nextZoom)
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !layout) return
    setOffset(
      clampOffset(
        {
          x: dragRef.current.offset.x + event.clientX - dragRef.current.pointer.x,
          y: dragRef.current.offset.y + event.clientY - dragRef.current.pointer.y,
        },
        layout,
        frameSize,
      ),
    )
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }

  async function save() {
    if (!layout || !imageRef.current || disabled) return
    setProcessing(true)
    setError("")
    try {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = outputSize
      const context = canvas.getContext("2d")
      if (!context) throw new Error("无法处理所选图片")
      const scale = outputSize / frameSize
      context.drawImage(
        imageRef.current,
        offset.x * scale,
        offset.y * scale,
        layout.width * scale,
        layout.height * scale,
      )
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      )
      if (!activeRef.current) return
      if (!blob || blob.type !== "image/webp") throw new Error("无法转换为 WebP 图片")
      if (!blob.size || blob.size > maxOutputBytes) {
        throw new Error("裁切后的头像文件不能超过 1MiB")
      }
      const bytes = await blob.arrayBuffer()
      if (activeRef.current) await onSave(bytes)
    } catch (reason) {
      if (activeRef.current) {
        setError(reason instanceof Error ? reason.message : "无法保存头像")
      }
    } finally {
      if (activeRef.current) setProcessing(false)
    }
  }

  return (
    <form
      id={formId}
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          chooseFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />
      <div className="grid w-full max-w-80 gap-4 sm:max-w-none sm:grid-cols-[minmax(0,1fr)_auto]">
        <div
          ref={frameRef}
          role={sourceUrl ? "img" : undefined}
          aria-label={sourceUrl ? "头像裁切区域" : undefined}
          className={`relative aspect-square w-full overflow-hidden rounded-md bg-muted ${sourceUrl ? (disabled ? "cursor-default opacity-60" : dragging ? "cursor-grabbing touch-none" : "cursor-grab touch-none") : "group/choose-image transition-colors hover:bg-muted/70"}`}
          onPointerDown={
            sourceUrl
              ? (event) => {
                  if (disabled || !layout) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  dragRef.current = {
                    pointer: { x: event.clientX, y: event.clientY },
                    offset,
                  }
                  setDragging(true)
                }
              : undefined
          }
          onPointerMove={sourceUrl ? movePointer : undefined}
          onPointerUp={sourceUrl ? endPointer : undefined}
          onPointerCancel={sourceUrl ? endPointer : undefined}
        >
          {sourceUrl ? (
            <img
              ref={imageRef}
              src={sourceUrl}
              alt=""
              draggable={false}
              className="absolute top-0 left-0 max-w-none select-none"
              onLoad={(event) => loadImage(event.currentTarget)}
              onError={() => {
                resetImage()
                setError("图片读取失败")
              }}
              style={
                layout
                  ? {
                      width: layout.width,
                      height: layout.height,
                      transform: `translate(${offset.x}px, ${offset.y}px)`,
                    }
                  : { opacity: 0 }
              }
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-md px-4 text-center text-sm text-muted-foreground focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              onClick={() => inputRef.current?.click()}
            >
              <span className="flex size-12 items-center justify-center rounded-md bg-background text-foreground shadow-xs transition-transform group-hover/choose-image:scale-105">
                <Upload className="size-5" aria-hidden />
              </span>
              <span className="text-foreground">选择图片</span>
              <span>PNG、JPG、WebP，最大 5MiB</span>
            </button>
          )}
          {!sourceUrl && (
            <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-foreground/15 ring-inset transition-shadow group-hover/choose-image:ring-primary/50 group-focus-within/choose-image:ring-primary/50" />
          )}
        </div>
        <div className="flex justify-between gap-3 sm:flex-col sm:items-center">
          <div className="flex gap-2 sm:flex-col">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="放大图片"
              title="放大图片"
              disabled={disabled || !layout || zoom >= 3}
              onClick={() => changeZoom(zoom + 0.1)}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="缩小图片"
              title="缩小图片"
              disabled={disabled || !layout || zoom <= 1}
              onClick={() => changeZoom(zoom - 0.1)}
            >
              <Minus className="size-4" />
            </Button>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="清除图片"
            title="清除图片"
            disabled={disabled || !sourceUrl}
            onClick={resetImage}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
