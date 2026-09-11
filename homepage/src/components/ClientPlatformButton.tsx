import { Button } from "@/components/ui/button"

type Props = {
  href: string
  label: string
  description: string
  iconBody: string
  platform?: string
}

export function ClientPlatformButton({ href, label, description, iconBody, platform }: Props) {
  return (
    <Button asChild variant="outline" motion={false} className="studio-client-platform-button">
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} · ${description}`} data-release-platform={platform}>
        <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconBody }} />
        <span className="studio-client-labels" aria-hidden="true">
          <span className="studio-client-name">{label}</span>
          <span className="studio-client-hover-label">{platform ? "下载" : label === "Web" ? "打开" : "App Store"}</span>
        </span>
      </a>
    </Button>
  )
}
