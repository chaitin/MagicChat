import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { AppInfoContext } from "@/lib/app-info-context"
import {
  ClientDataContext,
  type ClientDataContextValue,
} from "@/lib/client-data-context"

const logoFaviconHref = "/logo.png"
const alertFaviconHref = "/notification-bell.png?v=20260708-2"

function renderClientDocumentTitle({
  disableMessageAlert = false,
  unreadCount = 0,
}: {
  disableMessageAlert?: boolean
  unreadCount?: number
} = {}) {
  const clientData = {
    conversations: [
      {
        unreadCount,
      },
    ],
  } as ClientDataContextValue

  return render(
    <AppInfoContext.Provider
      value={{
        appName: "星环协作",
        authenticated: true,
        oidcProviders: [],
        organizationName: "长亭科技",
        thirdPartyProviders: [],
      }}
    >
      <ClientDataContext.Provider value={clientData}>
        <ClientDocumentTitle
          disableMessageAlert={disableMessageAlert}
          title="聊天"
        />
      </ClientDataContext.Provider>
    </AppInfoContext.Provider>
  )
}

function currentFaviconHref() {
  return document
    .querySelector<HTMLLinkElement>('link[rel~="icon"]')
    ?.getAttribute("href")
}

describe("ClientDocumentTitle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.head.innerHTML = `<link rel="icon" type="image/png" href="${logoFaviconHref}" />`
    document.title = ""
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps title text stable and blinks favicon when there are unread messages", async () => {
    renderClientDocumentTitle({ unreadCount: 2 })

    expect(document.title).toBe("聊天 - 星环协作")
    expect(currentFaviconHref()).toBe(alertFaviconHref)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(currentFaviconHref()).toBe(logoFaviconHref)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(currentFaviconHref()).toBe(alertFaviconHref)

    expect(document.title).toBe("聊天 - 星环协作")
  })

  it("restores the default favicon when message alert is disabled", async () => {
    renderClientDocumentTitle({
      disableMessageAlert: true,
      unreadCount: 2,
    })

    expect(document.title).toBe("聊天 - 星环协作")

    expect(currentFaviconHref()).toBe(logoFaviconHref)
  })
})
