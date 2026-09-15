import { useEffect, useRef } from "react"
import { ButtonLink } from "@/components/ui/button"
import { hydrateReleaseDownloadLinks } from "@/lib/release-downloads"

type Props = {
  href: string
  label: string
  description: string
  iconBody: string
  platform?: string
}

export function ClientPlatformButton({ href, label, description, iconBody, platform }: Props) {
  return (
    <ButtonLink variant="outline" className="studio-client-platform-button"
      href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} · ${description}`} data-release-platform={platform}>
      <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconBody }} />
      <span className="studio-client-labels" aria-hidden="true">
        <span className="studio-client-name">{label}</span>
        <span className="studio-client-hover-label">{platform ? "下载" : label === "Web" ? "打开" : "App Store"}</span>
      </span>
    </ButtonLink>
  )
}

export function ClientPlatforms({ clients }: { clients: Props[] }) {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    // Resolve download URLs once, after React has hydrated the fallback links.
    if (ref.current) void hydrateReleaseDownloadLinks(ref.current)
  }, [])

  return (
    <ul ref={ref} className="studio-client-platforms" aria-label="选择即应客户端">
      {clients.map(client => <li key={client.label}><ClientPlatformButton {...client} /></li>)}
    </ul>
  )
}
