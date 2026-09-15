import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { ScreenshotPayload, ScreenshotSelection } from "../shared/screenshot"

type Drag = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export function ScreenshotOverlay() {
  const [payload, setPayload] = useState<ScreenshotPayload | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [finishing, setFinishing] = useState(false)
  const pointerId = useRef<number | null>(null)
  const selection = useMemo(() => (drag ? normalizeSelection(drag) : null), [drag])

  useEffect(() => {
    void window.screenshot
      ?.initialize()
      .then(setPayload)
      .catch(() => window.screenshot?.cancel())
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.screenshot?.cancel()
    }
    window.addEventListener("keydown", cancel)
    return () => window.removeEventListener("keydown", cancel)
  }, [])

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (!payload || finishing || event.button !== 0) return
    pointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    })
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return
    setDrag((current) =>
      current ? { ...current, currentX: event.clientX, currentY: event.clientY } : current,
    )
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) return
    pointerId.current = null
    const finalSelection = drag
      ? normalizeSelection({ ...drag, currentX: event.clientX, currentY: event.clientY })
      : null
    if (!finalSelection || finalSelection.width < 2 || finalSelection.height < 2) {
      setDrag(null)
      return
    }
    setFinishing(true)
    const request: ScreenshotSelection = {
      ...finalSelection,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
    void window.screenshot?.complete(request).catch(() => setFinishing(false))
  }

  return (
    <main
      className="fixed inset-0 cursor-crosshair select-none overflow-hidden bg-black"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.screenshot?.cancel()
      }}
    >
      {payload ? (
        <img
          src={payload.imageUrl}
          alt=""
          draggable={false}
          className="pointer-events-none size-full object-fill"
        />
      ) : null}
      <div className="pointer-events-none absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white shadow-lg">
        拖动选择截图区域，按 Esc 取消
      </div>
      {selection ? (
        <div
          className="pointer-events-none absolute z-10 border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        >
          <span className="absolute -top-7 right-0 rounded bg-black/70 px-2 py-1 text-xs text-white">
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
        </div>
      ) : payload ? (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/20" />
      ) : null}
    </main>
  )
}

function normalizeSelection(drag: Drag) {
  return {
    x: Math.min(drag.startX, drag.currentX),
    y: Math.min(drag.startY, drag.currentY),
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  }
}
