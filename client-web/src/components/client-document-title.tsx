import { useContext, useEffect, useMemo, useRef } from "react"

import { useAppInfo } from "@/lib/app-info-context"
import { ClientDataContext } from "@/lib/client-data-context"

type ClientDocumentTitleProps = {
  alertIconHref?: string
  disableMessageAlert?: boolean
  title: string
}

const faviconBlinkIntervalMs = 500
const defaultAlertIconHref = "/notification-bell.png?v=20260708-2"

export function ClientDocumentTitle({
  alertIconHref = defaultAlertIconHref,
  disableMessageAlert = false,
  title,
}: ClientDocumentTitleProps) {
  const { appName } = useAppInfo()
  const clientData = useContext(ClientDataContext)
  const defaultFaviconHrefRef = useRef<string | null>(null)
  const conversations = clientData?.conversations
  const unreadCount = useMemo(() => {
    if (disableMessageAlert || !conversations) {
      return 0
    }

    return conversations.reduce(
      (total, conversation) => total + conversation.unreadCount,
      0
    )
  }, [conversations, disableMessageAlert])
  const hasMessageAlert = unreadCount > 0
  const pageTitle = `${title} - ${appName}`

  useEffect(() => {
    const faviconLink = getFaviconLink()
    if (!defaultFaviconHrefRef.current) {
      defaultFaviconHrefRef.current =
        faviconLink.getAttribute("href") ?? "/logo.png"
    }
    const defaultFaviconHref = defaultFaviconHrefRef.current

    document.title = pageTitle

    if (!hasMessageAlert) {
      setFaviconHref(defaultFaviconHref)
      return
    }

    let showingAlertIcon = true
    setFaviconHref(alertIconHref)
    const intervalId = window.setInterval(() => {
      showingAlertIcon = !showingAlertIcon
      setFaviconHref(showingAlertIcon ? alertIconHref : defaultFaviconHref)
    }, faviconBlinkIntervalMs)

    return () => {
      window.clearInterval(intervalId)
      setFaviconHref(defaultFaviconHref)
    }
  }, [alertIconHref, hasMessageAlert, pageTitle])

  return null
}

function getFaviconLink() {
  let faviconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (faviconLink) {
    return faviconLink
  }

  faviconLink = document.createElement("link")
  faviconLink.rel = "icon"
  faviconLink.type = "image/png"
  document.head.appendChild(faviconLink)

  return faviconLink
}

function setFaviconHref(href: string) {
  const faviconLink = getFaviconLink()
  faviconLink.setAttribute("href", href)
}
