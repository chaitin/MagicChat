import { useEffect, useState, type ReactNode } from "react"

import { defaultAppInfo, getClientInfo, type AppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"

export function AppInfoProvider({ children }: { children: ReactNode }) {
  const [appInfo, setAppInfo] = useState<AppInfo>(defaultAppInfo)

  useEffect(() => {
    let ignore = false

    async function loadAppInfo() {
      try {
        const info = await getClientInfo()

        if (!ignore) {
          setAppInfo(info)
        }
      } catch {
        if (!ignore) {
          setAppInfo(defaultAppInfo)
        }
      }
    }

    void loadAppInfo()

    return () => {
      ignore = true
    }
  }, [])

  return (
    <AppInfoContext.Provider value={appInfo}>
      {children}
    </AppInfoContext.Provider>
  )
}
