import { useEffect, useRef, useState } from "react"
import { BotIcon, Briefcase01Icon, UserIcon, UserMultiple02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { cn } from "@/lib/utils"
import type { AvatarResult, AvatarType } from "../../../shared/account-data"

const fallbackStyles: Record<AvatarResult["type"], string> = {
  user: "bg-xgui-indigo",
  app: "bg-xgui-blue",
  group: "bg-xgui-yellow",
  project: "bg-xgui-orange",
}

const fallbackIcons = {
  user: UserIcon,
  app: BotIcon,
  group: UserMultiple02Icon,
  project: Briefcase01Icon,
}

export function EntityAvatar({
  targetId,
  type,
  id,
  theme,
  size = 40,
  label,
  className,
  imageBackgroundClassName = "bg-xgui-background-1",
  cacheOnly = false,
}: {
  targetId: string
  type: AvatarType
  id: string
  theme: "light" | "dark"
  size?: number
  label?: string
  className?: string
  imageBackgroundClassName?: string
  cacheOnly?: boolean
}) {
  const defaultFallbackType = type === "topic" ? "group" : type
  const [result, setResult] = useState<AvatarResult | null>(null)
  const retryCount = useRef(0)
  const referenceKey = `${targetId}:${type}:${id}:${theme}:${cacheOnly}`
  const currentReference = useRef(referenceKey)
  currentReference.current = referenceKey

  useEffect(() => {
    let cancelled = false
    retryCount.current = 0
    setResult(null)
    if (!window.desktop || !targetId || !id) {
      setResult({ status: "fallback", type: defaultFallbackType })
      return
    }
    void window.desktop.accountData
      .getAvatar({ targetId, type, id, theme, ...(cacheOnly ? { cacheOnly: true } : {}) })
      .then((response) => {
        if (cancelled) return
        setResult(response.ok ? response.data : { status: "fallback", type: defaultFallbackType })
      })
      .catch(() => {
        if (!cancelled) setResult({ status: "fallback", type: defaultFallbackType })
      })
    return () => {
      cancelled = true
    }
  }, [cacheOnly, defaultFallbackType, id, targetId, theme, type])

  async function retryAfterRenderFailure() {
    const failedReference = referenceKey
    if (!window.desktop || cacheOnly || retryCount.current >= 1) {
      setResult((current) => ({
        status: "fallback",
        type: current?.type ?? defaultFallbackType,
      }))
      return
    }
    retryCount.current += 1
    setResult((current) => ({
      status: "fallback",
      type: current?.type ?? defaultFallbackType,
    }))
    try {
      await window.desktop.accountData.invalidateAvatar({ targetId, type, id })
      const response = await window.desktop.accountData.getAvatar({ targetId, type, id, theme })
      if (response.ok && currentReference.current === failedReference) setResult(response.data)
    } catch {
      // 保留已渲染的类型 Fallback。
    }
  }

  const fallbackType = result?.type ?? defaultFallbackType
  const showsFallback = result?.status === "fallback"
  const iconSize = Math.max(8, Math.min(32, size * (26 / 44)))
  return (
    <span
      role="img"
      aria-label={label ?? `${fallbackType} 头像`}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm text-white",
        showsFallback ? fallbackStyles[fallbackType] : imageBackgroundClassName,
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showsFallback ? (
        <HugeiconsIcon
          icon={fallbackIcons[fallbackType]}
          size={iconSize}
          strokeWidth={2}
          aria-hidden
        />
      ) : null}
      {result?.status === "ready" && result.resourceUrl ? (
        <img
          src={result.resourceUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={() => void retryAfterRenderFailure()}
        />
      ) : null}
    </span>
  )
}
