import type { BrowserWindow } from "electron"
import {
  AUTH_CHANNELS,
  AuthFailure,
  type SaveServerInput,
  type SignInInput,
  type ThirdPartySignInInput,
} from "../../shared/auth"
import type { AuthController } from "../auth-controller"
import type { IpcRegistrar } from "./register-account-data-ipc"

export function registerAuthIpc({
  handle,
  auth,
  getMainWindow,
}: {
  handle: IpcRegistrar
  auth: AuthController
  getMainWindow: () => BrowserWindow | null
}) {
  handle(AUTH_CHANNELS.getServer, () => auth.getServer())
  handle(AUTH_CHANNELS.getServers, () => auth.getServers())
  handle(AUTH_CHANNELS.restoreLastSession, () => auth.restoreLastSession())
  handle(AUTH_CHANNELS.saveServer, (input) => auth.saveServer(input as SaveServerInput))
  handle(AUTH_CHANNELS.deleteServer, (input) => auth.deleteServer(input as string))
  handle(AUTH_CHANNELS.checkServer, (input) => auth.checkServer(input as string))
  handle(AUTH_CHANNELS.checkServers, () => auth.checkServers())
  handle(AUTH_CHANNELS.connect, (input) => auth.connect(input as string))
  handle(AUTH_CHANNELS.signIn, (input) => auth.signIn(input as SignInInput))
  handle(AUTH_CHANNELS.signInThirdParty, (input) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new AuthFailure("window_unavailable", "主窗口不可用，请重试")
    return auth.signInThirdParty(input as ThirdPartySignInInput, mainWindow)
  })
  handle(AUTH_CHANNELS.sendCode, (input) =>
    auth.sendCode(input as { targetId: string; email: string }),
  )
  handle(AUTH_CHANNELS.signOut, (input) => auth.signOut(input as string))
}
