import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Check, Circle, EraserIcon, Pencil, Square, Undo2, X } from "lucide-react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import type {
  ScreenshotPayload,
  ScreenshotSelection,
  ScreenshotWindowBounds,
} from "../shared/screenshot"
import {
  paintScreenshot,
  normalizeSelection,
  moveSelection,
  resizeSelection,
  toolbarPosition,
  translateAnnotations,
  windowAtPoint,
  type Annotation,
  type DrawTool,
  type Point,
  type ResizeHandle,
  type ScreenshotRect,
} from "./screenshot-editor"

type Drag = {
  start: Point
  current: Point
  mode: "selection" | "annotation" | "move"
  origin?: ScreenshotRect
}

const handles: { id: ResizeHandle; label: string; x: number; y: number; cursor: string }[] = [
  { id: "nw", label: "左上角", x: 0, y: 0, cursor: "cursor-nwse-resize" },
  { id: "n", label: "上边", x: 0.5, y: 0, cursor: "cursor-ns-resize" },
  { id: "ne", label: "右上角", x: 1, y: 0, cursor: "cursor-nesw-resize" },
  { id: "e", label: "右边", x: 1, y: 0.5, cursor: "cursor-ew-resize" },
  { id: "se", label: "右下角", x: 1, y: 1, cursor: "cursor-nwse-resize" },
  { id: "s", label: "下边", x: 0.5, y: 1, cursor: "cursor-ns-resize" },
  { id: "sw", label: "左下角", x: 0, y: 1, cursor: "cursor-nesw-resize" },
  { id: "w", label: "左边", x: 0, y: 0.5, cursor: "cursor-ew-resize" },
]

const tools = [
  { id: "rectangle", label: "矩形", icon: Square },
  { id: "ellipse", label: "椭圆", icon: Circle },
  { id: "arrow", label: "箭头", icon: null },
  { id: "pen", label: "画笔", icon: Pencil },
  { id: "mosaic", label: "马赛克", icon: EraserIcon },
] as const

export function ScreenshotOverlay() {
  const [payload, setPayload] = useState<ScreenshotPayload | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [selection, setSelection] = useState<ScreenshotRect | null>(null)
  const [hoveredWindow, setHoveredWindow] = useState<ScreenshotWindowBounds | null>(null)
  const [resizing, setResizing] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState("")
  const pointerId = useRef<number | null>(null)
  const activationRef = useRef<Promise<void>>(Promise.resolve())
  const pendingWindow = useRef<ScreenshotWindowBounds | null>(null)
  const resizeRef = useRef<{
    pointerId: number
    handle: ResizeHandle
    start: Point
    original: ScreenshotRect
    annotations: Annotation[]
  } | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const visibleSelection =
    drag?.mode === "selection"
      ? normalizeSelection(drag.start, drag.current, viewport)
      : (selection ?? hoveredWindow)
  const toolbar =
    selection && !drag && !resizing
      ? toolbarPosition(selection, viewport, { width: 298, height: 44 })
      : null

  useEffect(() => {
    void window.screenshot
      ?.initialize()
      .then(setPayload)
      .catch(() => window.screenshot?.cancel())
  }, [])

  useEffect(
    () =>
      window.screenshot?.onResetSelection(() => {
        pointerId.current = null
        pendingWindow.current = null
        resizeRef.current = null
        setSelection(null)
        setHoveredWindow(null)
        setResizing(false)
        setDrag(null)
        setTool(null)
        setDraft(null)
        setAnnotations([])
        setError("")
      }),
    [],
  )

  useEffect(() => {
    if (!selection || !payload || !imageLoaded || !imageRef.current || !canvasRef.current) return
    paintScreenshot(
      canvasRef.current,
      imageRef.current,
      payload,
      selection,
      viewport,
      draft ? [...annotations, draft] : annotations,
    )
  }, [annotations, draft, imageLoaded, payload, selection, viewport.width, viewport.height])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void window.screenshot?.cancel()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        setAnnotations((current) => current.slice(0, -1))
      } else if (
        event.key === "Enter" &&
        selection &&
        !(event.target instanceof HTMLElement && event.target.closest("button, input"))
      ) {
        void confirm()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  function localPoint(point: Point, rect: ScreenshotRect): Point {
    return {
      x: Math.max(0, Math.min(rect.width, point.x - rect.x)),
      y: Math.max(0, Math.min(rect.height, point.y - rect.y)),
    }
  }

  function inside(point: Point, rect: ScreenshotRect) {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    )
  }

  function begin(event: ReactPointerEvent<HTMLElement>) {
    if (!payload || finishing || event.button !== 0 || pointerId.current !== null) return
    const point = { x: event.clientX, y: event.clientY }
    if (selection && !tool && inside(point, selection)) {
      setDrag({ start: point, current: point, mode: "move", origin: selection })
    } else if (selection && tool && inside(point, selection)) {
      const start = localPoint(point, selection)
      const annotation: Annotation =
        tool === "pen" || tool === "mosaic"
          ? { type: tool, points: [start] }
          : { type: tool, from: start, to: start }
      setDraft(annotation)
      setDrag({ start, current: start, mode: "annotation" })
    } else {
      activationRef.current = window.screenshot?.activate() ?? Promise.resolve()
      void activationRef.current.catch(() => setError("无法切换截图屏幕，请重试"))
      pendingWindow.current =
        !selection && hoveredWindow && inside(point, hoveredWindow) ? hoveredWindow : null
      setSelection(null)
      setHoveredWindow(null)
      setAnnotations([])
      setDraft(null)
      setError("")
      setDrag({ start: point, current: point, mode: "selection" })
    }
    pointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const point = { x: event.clientX, y: event.clientY }
    if (pointerId.current === null && !selection && !drag && payload && !resizing) {
      const hovered = windowAtPoint(payload.windows, point)
      setHoveredWindow((current) => (current === hovered ? current : hovered))
      return
    }
    if (pointerId.current !== event.pointerId || !drag) return
    if (drag.mode === "selection") {
      setDrag((current) => (current ? { ...current, current: point } : null))
    } else if (drag.mode === "move" && drag.origin) {
      setSelection(
        moveSelection(
          drag.origin,
          { x: point.x - drag.start.x, y: point.y - drag.start.y },
          viewport,
        ),
      )
    } else if (selection) {
      const end = localPoint(point, selection)
      setDrag((current) => (current ? { ...current, current: end } : null))
      setDraft((current) => {
        if (!current) return null
        if (current.type === "pen" || current.type === "mosaic") {
          return { ...current, points: [...current.points, end] }
        }
        return { ...current, to: end }
      })
    }
  }

  function finish(event: ReactPointerEvent<HTMLElement>) {
    if (pointerId.current !== event.pointerId || !drag) return
    pointerId.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const point = { x: event.clientX, y: event.clientY }
    if (drag.mode === "selection") {
      const rect = normalizeSelection(drag.start, point, viewport)
      const clickedWindow = rect.width < 3 && rect.height < 3 ? pendingWindow.current : null
      setSelection(clickedWindow ?? (rect.width >= 2 && rect.height >= 2 ? rect : null))
      pendingWindow.current = null
    } else if (drag.mode === "move" && drag.origin) {
      setSelection(
        moveSelection(
          drag.origin,
          { x: point.x - drag.start.x, y: point.y - drag.start.y },
          viewport,
        ),
      )
    } else if (selection && draft) {
      const end = localPoint(point, selection)
      if (draft.type === "pen" || draft.type === "mosaic") {
        setAnnotations((current) => [...current, { ...draft, points: [...draft.points, end] }])
      } else if ("from" in draft) {
        setAnnotations((current) => [...current, { ...draft, to: end }])
      }
    }
    setDrag(null)
    setDraft(null)
  }

  function updateResize(point: Point) {
    const active = resizeRef.current
    if (!active) return
    const next = resizeSelection(
      active.original,
      active.handle,
      { x: point.x - active.start.x, y: point.y - active.start.y },
      viewport,
    )
    setSelection(next)
    setAnnotations(
      translateAnnotations(active.annotations, {
        x: next.x - active.original.x,
        y: next.y - active.original.y,
      }),
    )
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) {
    event.stopPropagation()
    if (!selection || finishing || resizing) return
    resizeRef.current = {
      pointerId: event.pointerId,
      handle,
      start: { x: event.clientX, y: event.clientY },
      original: selection,
      annotations,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    updateResize({ x: event.clientX, y: event.clientY })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeRef.current = null
    setResizing(false)
  }

  async function confirm() {
    if (!selection || finishing || !window.screenshot) return
    setFinishing(true)
    setError("")
    try {
      await activationRef.current
      let editedPng: ArrayBuffer | undefined
      if (annotations.length) {
        const canvas = canvasRef.current
        if (
          !canvas ||
          !imageLoaded ||
          !imageRef.current ||
          !payload ||
          !paintScreenshot(canvas, imageRef.current, payload, selection, viewport, annotations)
        ) {
          throw new Error("截图画面尚未准备完成")
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        )
        if (!blob || blob.size > 32 * 1024 * 1024) throw new Error("截图内容过大，无法复制")
        editedPng = await blob.arrayBuffer()
      }
      const request: ScreenshotSelection = {
        ...selection,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        ...(editedPng ? { editedPng } : {}),
      }
      await window.screenshot.complete(request)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法复制截图")
      setFinishing(false)
    }
  }

  return (
    <main
      className="fixed inset-0 cursor-crosshair overflow-hidden bg-black select-none"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.screenshot?.cancel()
      }}
    >
      {payload && (
        <img
          ref={imageRef}
          src={payload.imageUrl}
          alt=""
          draggable={false}
          onLoad={() => setImageLoaded(true)}
          className="pointer-events-none size-full object-fill"
        />
      )}
      {payload && <div className="pointer-events-none absolute inset-0 bg-black/45" />}
      <div className="pointer-events-none absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white shadow-lg">
        {selection
          ? "在亮区标注，点击完成复制"
          : payload?.windows.length
            ? "悬停并点击窗口，或拖动自由框选；按 Esc 取消"
            : "拖动选择截图区域，按 Esc 取消"}
      </div>
      {visibleSelection &&
        visibleSelection.width >= 1 &&
        visibleSelection.height >= 1 &&
        payload && (
          <>
            <div
              className={`absolute z-10 overflow-hidden ${selection ? (tool ? "cursor-crosshair" : "cursor-move") : "pointer-events-none"}`}
              style={{
                left: visibleSelection.x,
                top: visibleSelection.y,
                width: visibleSelection.width,
                height: visibleSelection.height,
              }}
            >
              <img
                src={payload.imageUrl}
                alt=""
                draggable={false}
                className="absolute top-0 left-0 max-w-none"
                style={{
                  width: viewport.width,
                  height: viewport.height,
                  transform: `translate(${-visibleSelection.x}px, ${-visibleSelection.y}px)`,
                }}
              />
              {selection && (
                <canvas
                  ref={canvasRef}
                  className="pointer-events-none absolute inset-0 size-full"
                />
              )}
              <div
                className={`pointer-events-none absolute inset-0 z-20 border-2 ${selection ? "border-emerald-400" : "border-sky-400"}`}
              />
            </div>
            {selection &&
              !drag &&
              handles.map(({ id, label, x, y, cursor }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`拖动调整${label}`}
                  title="拖动调整截图大小"
                  disabled={finishing}
                  className={`absolute z-30 size-3 rounded-sm border-2 border-emerald-500 bg-white shadow-sm ${cursor} disabled:cursor-default`}
                  style={{
                    left: selection.x + selection.width * x,
                    top: selection.y + selection.height * y,
                    transform: "translate(-50%, -50%)",
                  }}
                  onPointerDown={(event) => beginResize(event, id)}
                  onPointerMove={(event) => {
                    if (resizeRef.current?.pointerId === event.pointerId) {
                      event.stopPropagation()
                      updateResize({ x: event.clientX, y: event.clientY })
                    }
                  }}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                />
              ))}
            <span
              className="pointer-events-none absolute z-20 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white"
              style={{
                left: Math.max(8, visibleSelection.x),
                top: Math.max(8, visibleSelection.y - 25),
              }}
            >
              {Math.round(visibleSelection.width)} × {Math.round(visibleSelection.height)}
            </span>
          </>
        )}
      {selection && toolbar && (
        <div
          role="toolbar"
          aria-label="截图编辑工具"
          className="absolute z-30 flex h-11 items-center gap-0.5 rounded-md border border-slate-300 bg-white px-1.5 text-slate-700 shadow-xl"
          style={{ left: toolbar.x, top: toolbar.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        >
          {tools.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={tool === id}
              disabled={finishing}
              className="flex size-8 cursor-pointer items-center justify-center rounded-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500 aria-pressed:bg-blue-100 aria-pressed:text-blue-700 disabled:opacity-50"
              onClick={() => setTool((current) => (current === id ? null : id))}
            >
              {id === "arrow" ? (
                <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" aria-hidden />
              ) : (
                <Icon className="size-4" aria-hidden />
              )}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button
            type="button"
            aria-label="撤销标注"
            title="撤销标注 (Ctrl+Z)"
            disabled={!annotations.length || finishing}
            className="flex size-8 cursor-pointer items-center justify-center rounded-sm hover:bg-slate-100 disabled:opacity-40"
            onClick={() => setAnnotations((current) => current.slice(0, -1))}
          >
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="取消截图"
            title="取消截图"
            disabled={finishing}
            className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
            onClick={() => void window.screenshot?.cancel()}
          >
            <X className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="完成并复制"
            title="完成并复制"
            disabled={finishing}
            className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-green-700 hover:bg-green-50 disabled:opacity-40"
            onClick={() => void confirm()}
          >
            <Check className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="pointer-events-none absolute right-4 bottom-4 z-30 rounded bg-red-700 px-3 py-2 text-sm text-white"
        >
          {error}
        </p>
      )}
    </main>
  )
}
