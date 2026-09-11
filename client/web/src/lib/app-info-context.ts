import { createContext, useContext } from "react"

import { defaultAppInfo, type AppInfo } from "@/lib/app-info"

export type AppInfoContextValue = AppInfo & {
  setAuthenticated: (authenticated: boolean) => void
}

export const AppInfoContext = createContext<AppInfoContextValue>({
  ...defaultAppInfo,
  setAuthenticated: () => undefined,
})

export function useAppInfo() {
  return useContext(AppInfoContext)
}
