import { useEffect, useState, type ReactNode } from "react"
import {
  Cancel01Icon,
  ChangeScreenModeIcon,
  RectangularIcon,
  MinusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"

export function WindowTitleBar() {
  const controls = window.desktop?.windowControls
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!controls) return
    let cancelled = false
    void controls.getMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const unsubscribe = controls.onMaximizedChange(setMaximized)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [controls])

  return (
    <header className="relative z-50 flex h-8 shrink-0 items-center bg-xgui-background-6 [-webkit-app-region:drag]">
      {controls && controls.platform !== "macos" ? (
        <div className="ml-auto flex h-full [-webkit-app-region:no-drag]">
          <WindowButton label="最小化" onClick={() => void controls?.minimize()}>
            <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" aria-hidden />
          </WindowButton>
          <WindowButton
            label={maximized ? "还原" : "最大化"}
            onClick={() => void controls?.toggleMaximize()}
          >
            <HugeiconsIcon
              icon={maximized ? ChangeScreenModeIcon : RectangularIcon}
              className="size-3.5"
              aria-hidden
            />
          </WindowButton>
          <WindowButton label="关闭" onClick={() => void controls?.close()}>
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
          </WindowButton>
        </div>
      ) : null}
    </header>
  )
}

function WindowButton({
  label,
  className = "",
  onClick,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-8 w-9 items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
