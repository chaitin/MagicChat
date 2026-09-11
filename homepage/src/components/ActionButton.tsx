import type { ComponentProps } from "react"
import { ArrowLeft, ArrowUpRight, Download, Server, Monitor, MonitorPlay, Apple, Terminal, Smartphone, Code, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

const icons = {
  "arrow-left": ArrowLeft,
  "arrow-up-right": ArrowUpRight,
  download: Download,
  server: Server,
  "monitor-play": MonitorPlay,
  code: Code,
  "book-open": BookOpen,
  "tabler:brand-windows": Monitor,
  "tabler:brand-apple": Apple,
  "tabler:brand-ubuntu": Terminal,
  "tabler:brand-android": Smartphone,
}

type Props = {
  href: string
  label: string
  icon?: keyof typeof icons
  trailingIcon?: keyof typeof icons
  external?: boolean
  platform?: string
  variant?: ComponentProps<typeof Button>["variant"]
  size?: ComponentProps<typeof Button>["size"]
  className?: string
}

export function ActionButton({ href, label, icon, trailingIcon, external, platform, variant = "default", size = "default", className }: Props) {
  const LeadingIcon = icon ? icons[icon] : null
  const TrailingIcon = trailingIcon ? icons[trailingIcon] : null
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} data-release-platform={platform}>
        {LeadingIcon && <LeadingIcon aria-hidden="true" />}
        <span>{label}</span>
        {TrailingIcon && <TrailingIcon aria-hidden="true" />}
      </a>
    </Button>
  )
}
