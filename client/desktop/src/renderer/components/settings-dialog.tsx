"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DownloadCircle02Icon,
  InformationCircleIcon,
  LinkSquare02Icon,
  Loading03Icon,
  PaintBrush01Icon,
  RefreshCwIcon,
  ServerStack01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select"
import { ServerSettings } from "@/components/server-settings"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import type { ServerCatalog } from "../../shared/auth"
import { APP_VERSION, BUILD_ID } from "../../shared/build-info"
import type { SystemInfo, UpdateInfo } from "../../shared/desktop"

export type SettingsSection = "appearance" | "servers" | "about"

const sections = [
  { id: "servers" as const, name: "服务器", icon: ServerStack01Icon },
  { id: "appearance" as const, name: "外观", icon: PaintBrush01Icon },
  { id: "about" as const, name: "关于", icon: InformationCircleIcon },
]

export function SettingsDialog({
  theme,
  catalog,
  disabled,
  onThemeChange,
  onCatalogChange,
  open,
  onOpenChange,
  defaultSection = "servers",
  trigger,
}: {
  theme: "light" | "dark" | "system"
  catalog: ServerCatalog
  disabled: boolean
  onThemeChange: (theme: "light" | "dark" | "system") => void
  onCatalogChange: (catalog: ServerCatalog) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultSection?: SettingsSection
  trigger?: React.ReactNode
}) {
  const { showToast } = useAnimatedToast()
  const [section, setSection] = React.useState<SettingsSection>(defaultSection)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = React.useState(false)
  const [availableUpdate, setAvailableUpdate] = React.useState<UpdateInfo | null>(null)
  const current = sections.find((item) => item.id === section)!
  const isOpen = open ?? internalOpen

  React.useEffect(() => {
    if (section !== "about" || systemInfo || !window.desktop) return
    let cancelled = false
    void window.desktop.getSystemInfo().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSystemInfo(result.data)
      } else {
        showToast({ status: "error", title: "无法获取系统信息", description: result.error.message })
      }
    })
    return () => {
      cancelled = true
    }
  }, [section, showToast, systemInfo])

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  async function checkUpdates() {
    if (checkingUpdate) return
    if (!window.desktop) {
      showToast({ status: "error", title: "请在桌面客户端中检查更新" })
      return
    }
    setCheckingUpdate(true)
    try {
      const result = await window.desktop.checkForUpdates()
      if (!result.ok) {
        showToast({
          status: "error",
          title: "检查更新失败",
          description: result.error.message,
        })
      } else if (result.data.updateAvailable) {
        setAvailableUpdate(result.data)
        showToast({
          status: "info",
          title: "发现新版本",
          description: `${result.data.latestVersion}（Build ${result.data.latestBuildId}）`,
        })
      } else {
        setAvailableUpdate(null)
        showToast({ status: "success", title: "当前已是最新版本" })
      }
    } catch {
      showToast({ status: "error", title: "无法检查更新，请稍后重试" })
    } finally {
      setCheckingUpdate(false)
    }
  }

  async function downloadUpdate() {
    if (!availableUpdate || !window.desktop) return
    const result = await window.desktop.openExternalLink(availableUpdate.downloadUrl)
    if (!result.ok) {
      showToast({ status: "error", title: "无法打开下载地址", description: result.error.message })
    }
  }

  const defaultTrigger = (
    <BeButton
      type="button"
      variant="ghost"
      size="sm"
      className="gap-2 rounded-md px-2.5 text-sm text-current hover:text-current"
    >
      <HugeiconsIcon icon={Settings02Icon} className="size-4" aria-hidden />
      设置
    </BeButton>
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger === null ? null : <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>}
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">
          修改即应桌面端的外观和服务器配置，并查看应用信息。
        </DialogDescription>
        <SidebarProvider
          className="h-[500px] min-h-0 max-h-[calc(100svh-2rem)] items-stretch"
          style={{ "--sidebar-width": "10rem" } as React.CSSProperties}
        >
          <Sidebar collapsible="none" className="settings-sidebar hidden md:flex">
            <SidebarHeader className="h-16 justify-center px-4">
              <p className="text-sm font-normal">设置</p>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu aria-label="设置分类">
                    {sections.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={section === item.id}
                          aria-current={section === item.id ? "page" : undefined}
                          onClick={() => setSection(item.id)}
                        >
                          <HugeiconsIcon icon={item.icon} aria-hidden />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center px-6">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <BeButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto rounded-none p-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                        onClick={() => setSection("appearance")}
                      >
                        即应
                      </BeButton>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <BeButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto rounded-none p-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                        onClick={() => setSection("appearance")}
                      >
                        设置
                      </BeButton>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
              {section === "appearance" ? (
                <section className="space-y-5">
                  <div className="grid grid-cols-[1fr_2fr] items-center gap-4">
                    <label className="text-sm font-medium" htmlFor="theme-select">
                      主题
                    </label>
                    <Select
                      value={theme}
                      onValueChange={(value) => onThemeChange(value as typeof theme)}
                    >
                      <SelectTrigger id="theme-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">明亮模式</SelectItem>
                        <SelectItem value="dark">黑暗模式</SelectItem>
                        <SelectItem value="system">跟随系统</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </section>
              ) : section === "servers" ? (
                <ServerSettings
                  catalog={catalog}
                  disabled={disabled}
                  onCatalogChange={onCatalogChange}
                />
              ) : (
                <section aria-label="关于即应">
                  <ItemGroup className="gap-3">
                    <Item variant="outline" size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle>版本信息</ItemTitle>
                        <ItemDescription>
                          版本 {APP_VERSION} · Build {BUILD_ID}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="shrink-0">
                        {availableUpdate && (
                          <BeButton
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void downloadUpdate()}
                          >
                            <HugeiconsIcon icon={DownloadCircle02Icon} aria-hidden />
                            下载新版本
                          </BeButton>
                        )}
                        <BeButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={checkingUpdate}
                          onClick={() => void checkUpdates()}
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
                      description="https://github.com/chaitin/MagicChat"
                      href="https://github.com/chaitin/MagicChat"
                      action="访问"
                    />
                    <AboutItem
                      title="官方网站"
                      description="https://jiying.chat/"
                      href="https://jiying.chat/"
                      action="访问"
                    />

                    <Item variant="outline" size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle>版权信息</ItemTitle>
                        <ItemDescription>© 2026 长亭百智云</ItemDescription>
                      </ItemContent>
                    </Item>
                  </ItemGroup>
                </section>
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

function AboutItem({
  title,
  description,
  href,
  action,
}: {
  title: string
  description: string
  href: string
  action: string
}) {
  const { showToast } = useAnimatedToast()

  async function openLink() {
    if (!window.desktop) {
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }
    const result = await window.desktop.openExternalLink(href)
    if (!result.ok) {
      showToast({ status: "error", title: "无法打开链接", description: result.error.message })
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
          {action}
        </BeButton>
      </ItemActions>
    </Item>
  )
}
