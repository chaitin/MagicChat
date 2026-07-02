import { createContext, useContext } from "react"

import { defaultAppInfo, type AppInfo } from "@/lib/app-info"

export const AppInfoContext = createContext<AppInfo>(defaultAppInfo)

export function useAppInfo() {
  return useContext(AppInfoContext)
}
