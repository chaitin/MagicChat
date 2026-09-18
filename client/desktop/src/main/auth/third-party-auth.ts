import { BrowserWindow, type Session } from "electron"
import { AuthFailure, type ThirdPartyProvider } from "../../shared/auth"
import type { NativeSessionCredential } from "./auth-api"

const userSessionCookie = "user_session"
const thirdPartyStateCookie = "third_party_login_state"
const redirectPathname = "/init"
const timeoutMs = 5 * 60_000

export function openThirdPartyLoginWindow({
  serverSession,
  serverUrl,
  provider,
  parent,
}: {
  serverSession: Session
  serverUrl: string
  provider: ThirdPartyProvider
  parent: BrowserWindow
}): Promise<NativeSessionCredential> {
  const serverOrigin = new URL(serverUrl).origin
  const redirectPath = `${redirectPathname}?desktop-auth=complete`
  const startUrl = new URL(
    `${serverUrl}/api/client/auth/third-party/${encodeURIComponent(provider.key)}/start`,
  )
  startUrl.searchParams.set("redirect", redirectPath)

  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 560,
      title: `使用 ${provider.name} 登录`,
      show: false,
      webPreferences: {
        session: serverSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    authWindow.removeMenu()
    authWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    authWindow.webContents.on("will-navigate", (event, targetUrl) => {
      try {
        if (!/^https?:$/.test(new URL(targetUrl).protocol)) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })

    let settled = false
    const timer = setTimeout(
      () => finish(() => reject(new AuthFailure("third_party_timeout", "第三方登录超时，请重试"))),
      timeoutMs,
    )
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!authWindow.isDestroyed()) authWindow.destroy()
      complete()
    }
    const completeFromNavigation = async (targetUrl: string) => {
      if (settled) return
      let url: URL
      try {
        url = new URL(targetUrl)
      } catch {
        return
      }
      if (
        url.origin !== serverOrigin ||
        url.pathname !== redirectPathname ||
        url.searchParams.get("desktop-auth") !== "complete"
      ) {
        return
      }
      try {
        const cookies = await serverSession.cookies.get({
          url: `${serverOrigin}/`,
          name: userSessionCookie,
        })
        const cookie = cookies.find(
          (item) =>
            Boolean(item.value) &&
            typeof item.expirationDate === "number" &&
            item.expirationDate * 1_000 > Date.now(),
        )
        if (!cookie?.value || cookie.value.length > 8_192 || !cookie.expirationDate) {
          throw new AuthFailure("invalid_session", "第三方登录未返回有效凭据")
        }
        finish(() =>
          resolve({
            token: cookie.value,
            expiresAt: new Date(cookie.expirationDate! * 1_000).toISOString(),
          }),
        )
      } catch (error) {
        finish(() => reject(error))
      }
    }

    authWindow.once("ready-to-show", () => authWindow.show())
    authWindow.once("closed", () => {
      if (!settled)
        finish(() => reject(new AuthFailure("third_party_cancelled", "已取消第三方登录")))
    })
    authWindow.webContents.on("did-navigate", (_event, targetUrl) => {
      void completeFromNavigation(targetUrl)
    })
    void authWindow.loadURL(startUrl.toString()).catch((error) => {
      finish(() =>
        reject(
          new AuthFailure(
            "third_party_unavailable",
            error instanceof Error ? "无法打开第三方登录页面，请重试" : "第三方登录不可用",
          ),
        ),
      )
    })
  })
}

export async function clearServerAuthCookies(serverSession: Session, serverUrl: string) {
  const origin = new URL(serverUrl).origin
  await Promise.allSettled([
    serverSession.cookies.remove(`${origin}/`, userSessionCookie),
    serverSession.cookies.remove(`${origin}/api/client/auth/third-party/`, thirdPartyStateCookie),
  ])
  await serverSession.cookies.flushStore()
}
