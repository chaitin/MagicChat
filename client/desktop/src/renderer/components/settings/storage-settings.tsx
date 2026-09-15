import { useEffect, useState } from "react"
import { Analytics01Icon, FolderOpenIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"

export function StorageSettings({ disabled }: { disabled: boolean }) {
  const { showToast } = useAnimatedToast()
  const [directoryPath, setDirectoryPath] = useState("")
  const [calculating, setCalculating] = useState(false)
  const [usageBytes, setUsageBytes] = useState<number | null>(null)
  const [resultOpen, setResultOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!window.desktop) return
    void window.desktop
      .getStorageInfo()
      .then((result) => {
        if (cancelled) return
        if (result.ok) setDirectoryPath(result.data.directoryPath)
        else {
          showToast({
            status: "error",
            title: "无法获取存储路径",
            description: result.error.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) showToast({ status: "error", title: "无法获取存储路径" })
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  async function openDirectory() {
    if (!window.desktop) return
    try {
      const result = await window.desktop.openStorageDirectory()
      if (!result.ok) {
        showToast({
          status: "error",
          title: "无法打开存储目录",
          description: result.error.message,
        })
      }
    } catch {
      showToast({ status: "error", title: "无法打开存储目录，请稍后重试" })
    }
  }

  async function calculateUsage() {
    if (!window.desktop || calculating) return
    setCalculating(true)
    try {
      const result = await window.desktop.calculateStorageUsage()
      if (!result.ok) {
        showToast({
          status: "error",
          title: "无法计算空间占用",
          description: result.error.message,
        })
        return
      }
      setUsageBytes(result.data.bytes)
      setResultOpen(true)
    } catch {
      showToast({ status: "error", title: "无法计算空间占用，请稍后重试" })
    } finally {
      setCalculating(false)
    }
  }

  return (
    <>
      <section aria-label="存储设置">
        <ItemGroup className="gap-3">
          <Item variant="outline" size="sm">
            <ItemContent className="min-w-0">
              <ItemTitle>存储路径</ItemTitle>
              <ItemDescription className="line-clamp-1" title={directoryPath || undefined}>
                {directoryPath || (window.desktop ? "正在获取" : "浏览器预览不可用")}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0">
              <BeButton
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !directoryPath}
                onClick={() => void openDirectory()}
              >
                <HugeiconsIcon icon={FolderOpenIcon} aria-hidden />
                打开
              </BeButton>
            </ItemActions>
          </Item>

          <Item variant="outline" size="sm">
            <ItemContent className="min-w-0">
              <ItemTitle>空间占用</ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0">
              <BeButton
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || calculating}
                onClick={() => void calculateUsage()}
              >
                <HugeiconsIcon
                  icon={calculating ? Loading03Icon : Analytics01Icon}
                  className={calculating ? "animate-spin" : undefined}
                  aria-hidden
                />
                {calculating ? "计算中" : "计算"}
              </BeButton>
            </ItemActions>
          </Item>
        </ItemGroup>
      </section>

      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>空间占用</DialogTitle>
            <DialogDescription>
              当前存储目录共占用 {usageBytes === null ? "—" : formatBytes(usageBytes)}。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <BeButton type="button" variant="primary" size="sm">
                知道了
              </BeButton>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1_024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024
    unit = units[index]
  }
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(fractionDigits)} ${unit}`
}
