import { useEffect, type RefObject } from "react"

export const MESSAGE_HIGHLIGHT_DURATION_MS = 2_000

export function useMessageHighlight(
  ref: RefObject<HTMLElement | null>,
  requestKey: number | undefined
) {
  useEffect(() => {
    if (requestKey === undefined || !ref.current) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const animation = ref.current.animate(
      [
        { boxShadow: "0 0 0 2px var(--xgui-orange)" },
        { boxShadow: "0 0 0 2px transparent" },
      ],
      {
        duration: MESSAGE_HIGHLIGHT_DURATION_MS,
        easing: "linear",
        fill: "forwards",
      }
    )
    return () => animation.cancel()
  }, [ref, requestKey])
}
