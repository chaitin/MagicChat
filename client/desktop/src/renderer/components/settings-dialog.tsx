"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  InformationCircleIcon,
  PaintBrush01Icon,
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
import { ServerSettings } from "@/components/server-settings"
import { AboutSettings } from "@/components/settings/about-settings"
import { AppearanceSettings } from "@/components/settings/appearance-settings"
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
import type { ThemePreference } from "../../shared/desktop"

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
  theme: ThemePreference
  catalog: ServerCatalog
  disabled: boolean
  onThemeChange: (theme: ThemePreference) => void
  onCatalogChange: (catalog: ServerCatalog) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultSection?: SettingsSection
  trigger?: React.ReactNode
}) {
  const [section, setSection] = React.useState<SettingsSection>(defaultSection)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const current = sections.find((item) => item.id === section)!
  const isOpen = open ?? internalOpen

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
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
                <AppearanceSettings theme={theme} onThemeChange={onThemeChange} />
              ) : section === "servers" ? (
                <ServerSettings
                  catalog={catalog}
                  disabled={disabled}
                  onCatalogChange={onCatalogChange}
                />
              ) : null}
              <AboutSettings active={section === "about"} />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
