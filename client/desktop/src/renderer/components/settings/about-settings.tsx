import { useEffect, useState } from "react"
import { LinkSquare02Icon, Loading03Icon, RefreshCwIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { APP_VERSION } from "../../../shared/build-info"
import { useUpdateDialog } from "../../update-provider"
import { JIYING_HOMEPAGE, MAGICCHAT_REPOSITORY, type SystemInfo } from "../../../shared/desktop"

export function AboutSettings({ active }: { active: boolean }) {
  const { showToast } = useAnimatedToast()
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const { checking: checkingUpdate, checkUpdates } = useUpdateDialog()

  useEffect(() => {
    if (!active || systemInfo || !window.desktop) return
    let cancelled = false
    void window.desktop
      .getSystemInfo()
      .then((result) => {
        if (cancelled) return
        if (result.ok) setSystemInfo(result.data)
        else {
          showToast({
            status: "error",
            title: "无法获取系统信息",
            description: result.error.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) showToast({ status: "error", title: "无法获取系统信息" })
      })
    return () => {
      cancelled = true
    }
  }, [active, showToast, systemInfo])

  if (!active) return null

  return (
    <section aria-label="关于即应">
      <ItemGroup className="gap-3">
        <Item variant="outline" size="sm">
          <ItemContent className="min-w-0">
            <ItemTitle>版本信息</ItemTitle>
            <ItemDescription>版本 {APP_VERSION}</ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0">
            <BeButton
              type="button"
              variant="outline"
              size="sm"
              disabled={checkingUpdate}
              onClick={() => checkUpdates(true)}
            >
              <HugeiconsIcon
                icon={checkingUpdate ? Loading03Icon : RefreshCwIcon}
                className={checkingUpdate ? "animate-spin" : undefined}
                aria-hidden
              />
              {checkingUpdate ? "检查中" : "检查更新"}
            </BeButton>
          </ItemActions>
        </Item>

        <Item variant="outline" size="sm">
          <ItemContent className="min-w-0">
            <ItemTitle>当前系统</ItemTitle>
            <ItemDescription className="break-all">
              {systemInfo
                ? `${systemInfo.type} · ${systemInfo.version} · ${systemInfo.architecture}`
                : window.desktop
                  ? "正在获取系统信息"
                  : "浏览器预览"}
            </ItemDescription>
          </ItemContent>
        </Item>

        <AboutItem
          title="开源仓库"
          description={MAGICCHAT_REPOSITORY}
          href={MAGICCHAT_REPOSITORY}
        />
        <AboutItem title="官方网站" description={JIYING_HOMEPAGE} href={JIYING_HOMEPAGE} />

        <Item variant="outline" size="sm">
          <ItemContent className="min-w-0">
            <ItemTitle>版权信息</ItemTitle>
            <ItemDescription>© 2026 长亭百智云</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </section>
  )
}

function AboutItem({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  const { showToast } = useAnimatedToast()

  async function openLink() {
    if (!window.desktop) {
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }
    try {
      const result = await window.desktop.openExternalLink(href)
      if (!result.ok) {
        showToast({ status: "error", title: "无法打开链接", description: result.error.message })
      }
    } catch {
      showToast({ status: "error", title: "无法打开链接" })
    }
  }

  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="break-all">{description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <BeButton type="button" variant="outline" size="sm" onClick={openLink}>
          <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden />
          访问
        </BeButton>
      </ItemActions>
    </Item>
  )
}
