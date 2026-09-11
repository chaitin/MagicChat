import { Download, X } from "lucide-react"
import { useEffect, useState, type ComponentType, type SVGProps } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ClientDownload = {
  label?: string
  url: string
}

type ClientPlatform = {
  downloads?: ClientDownload[]
  icon: ComponentType<SVGProps<SVGSVGElement>>
  name: string
  released: boolean
}

type ClientVersion = {
  url?: string
  version?: string
}

type ClientVersionManifest = Record<string, ClientVersion | undefined>

const VERSION_MANIFEST_URL = "https://jiying.chat/releases/version.json"

const fallbackDownloads: Record<string, ClientDownload[]> = {
  android: [{ url: "https://jiying.chat/releases/jiying.apk" }],
  "linux-amd": [
    {
      label: "x64 / AMD64",
      url: "https://jiying.chat/releases/jiying.amd.AppImage",
    },
  ],
  "linux-arm": [
    {
      label: "ARM64",
      url: "https://jiying.chat/releases/jiying.arm.AppImage",
    },
  ],
  macos: [{ url: "https://jiying.chat/releases/jiying.dmg" }],
  windows: [{ url: "https://jiying.chat/releases/jiying.exe" }],
}

function WindowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M0 0h24v24H0z" fill="none" stroke="none" />
      <path d="m17.8 20-12-1.5c-1-.1-1.8-.9-1.8-1.9V7.4c0-1 .8-1.8 1.8-1.9l12-1.5c1.2-.1 2.2.8 2.2 1.9V18c0 1.2-1.1 2.1-2.2 1.9z" />
      <path d="M12 5v14" />
      <path d="M4 12h16" />
    </svg>
  )
}

function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M0 0h24v24H0z" fill="none" stroke="none" />
      <path d="M8.286 7.008C5.07 7.008 4 10.238 4 12.928 4 16.157 6.143 21 8.286 21c1.165-.05 1.799-.538 3.214-.538 1.406 0 1.607.538 3.214.538S19 17.771 19 15.619c-.03-.011-2.649-.434-2.679-3.23-.02-2.335 2.589-3.179 2.679-3.228-1.096-1.606-3.162-2.113-3.75-2.153-1.535-.12-3.032 1.077-3.75 1.077-.729 0-2.036-1.077-3.214-1.077" />
      <path d="M12 4a2 2 0 0 0 2-2 2 2 0 0 0-2 2" />
    </svg>
  )
}

function UbuntuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M0 0h24v24H0z" fill="none" stroke="none" />
      <path d="M10 5a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
      <path d="M17.723 7.41a7.992 7.992 0 0 0-3.74-2.162m-3.971 0a7.993 7.993 0 0 0-3.789 2.216m-1.881 3.215A8 8 0 0 0 4 12.999c0 .738.1 1.453.287 2.132m1.96 3.428a7.993 7.993 0 0 0 3.759 2.19m4 0a7.993 7.993 0 0 0 3.747-2.186m1.962-3.43a8.008 8.008 0 0 0 .287-2.131c0-.764-.107-1.503-.307-2.203" />
      <path d="M3 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
      <path d="M17 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
    </svg>
  )
}

function AndroidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M0 0h24v24H0z" fill="none" stroke="none" />
      <path d="M4 10v6" />
      <path d="M20 10v6" />
      <path d="M7 9h10v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a5 5 0 0 1 10 0" />
      <path d="m8 3 1 2" />
      <path d="m16 3-1 2" />
      <path d="M9 18v3" />
      <path d="M15 18v3" />
    </svg>
  )
}

function createClientPlatforms(
  manifest?: ClientVersionManifest
): ClientPlatform[] {
  const downloadsFor = (key: string) => {
    const entry = manifest?.[key]
    return entry?.url ? [{ url: entry.url }] : (fallbackDownloads[key] ?? [])
  }

  return [
    {
      downloads: downloadsFor("windows"),
      icon: WindowsIcon,
      name: "Windows",
      released: true,
    },
    {
      downloads: downloadsFor("macos"),
      icon: AppleIcon,
      name: "macOS",
      released: true,
    },
    {
      downloads: [
        ...downloadsFor("linux-amd").map((download) => ({
          ...download,
          label: "x64 / AMD64",
        })),
        ...downloadsFor("linux-arm").map((download) => ({
          ...download,
          label: "ARM64",
        })),
      ],
      icon: UbuntuIcon,
      name: "Linux",
      released: true,
    },
    {
      downloads: downloadsFor("android"),
      icon: AndroidIcon,
      name: "Android",
      released: true,
    },
    {
      icon: AppleIcon,
      name: "iOS",
      released: false,
    },
  ]
}

export function ClientDownloadDialog() {
  const [manifest, setManifest] = useState<ClientVersionManifest>()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || manifest) return

    const controller = new AbortController()

    async function loadManifest() {
      try {
        const response = await fetch(VERSION_MANIFEST_URL, {
          signal: controller.signal,
        })
        if (!response.ok) return
        setManifest((await response.json()) as ClientVersionManifest)
      } catch {
        // Keep the stable fallback URLs when the manifest is unavailable.
      }
    }

    void loadManifest()
    return () => controller.abort()
  }, [manifest, open])

  const clientPlatforms = createClientPlatforms(manifest)

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="下载客户端"
          className="rounded-md hover:bg-transparent hover:text-(--weui-brand-3) aria-expanded:bg-transparent aria-expanded:text-(--weui-brand-3) data-[state=open]:bg-transparent data-[state=open]:text-(--weui-brand-3) dark:hover:bg-transparent"
          size="icon-sm"
          title="下载客户端"
          type="button"
          variant="ghost"
        >
          <Download className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-6 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="pr-10">
          <DialogTitle>下载客户端</DialogTitle>
          <DialogDescription>选择适合当前设备的客户端</DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            aria-label="关闭下载客户端"
            className="absolute top-4 right-4"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>

        <div className="flex flex-wrap justify-center gap-2 sm:justify-between">
          {clientPlatforms.map((platform) => (
            <ClientPlatformCard key={platform.name} platform={platform} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ClientPlatformCard({ platform }: { platform: ClientPlatform }) {
  const Icon = platform.icon

  const platformButtonClass =
    "size-22 cursor-pointer flex-col gap-1.5 rounded-full bg-(--weui-brand-3) p-0 text-xs text-white shadow-none hover:bg-(--weui-brand-4) hover:text-white aria-expanded:bg-(--weui-brand-4) aria-expanded:text-white dark:text-white"

  if (!platform.released) {
    return (
      <Button
        aria-label={`${platform.name} 客户端敬请期待`}
        className={platformButtonClass}
        disabled
        type="button"
        variant="secondary"
      >
        <Icon aria-hidden="true" className="size-7" />
        <span>{platform.name}</span>
      </Button>
    )
  }

  if (!platform.downloads?.length) {
    return (
      <Button
        aria-label={`${platform.name} 客户端下载地址待配置`}
        className={platformButtonClass}
        disabled
        type="button"
        variant="secondary"
      >
        <Icon aria-hidden="true" className="size-7" />
        <span>{platform.name}</span>
      </Button>
    )
  }

  if (platform.downloads.length > 1) {
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`下载 ${platform.name} 客户端`}
            className={platformButtonClass}
            type="button"
            variant="secondary"
          >
            <Icon aria-hidden="true" className="size-7" />
            <span>{platform.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-44">
          {platform.downloads.map((download) => (
            <DropdownMenuItem
              asChild
              className="whitespace-nowrap"
              key={download.url}
            >
              <a
                aria-label={`下载 ${platform.name} ${download.label} 客户端`}
                href={download.url}
                rel="noreferrer"
                target="_blank"
              >
                <Download aria-hidden="true" />
                {download.label}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Button asChild className={platformButtonClass} variant="secondary">
      <a
        aria-label={`下载 ${platform.name} 客户端`}
        href={platform.downloads[0].url}
        rel="noreferrer"
        target="_blank"
      >
        <Icon aria-hidden="true" className="size-7" />
        <span>{platform.name}</span>
      </a>
    </Button>
  )
}
