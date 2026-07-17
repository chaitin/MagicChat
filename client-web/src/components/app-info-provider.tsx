import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { defaultAppInfo, getClientInfo, type AppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"

export function AppInfoProvider({ children }: { children: ReactNode }) {
  const [appInfo, setAppInfo] = useState<AppInfo>(defaultAppInfo)
  const [authenticatedOverride, setAuthenticatedOverride] = useState<
    boolean | null
  >(null)

  const setAuthenticated = useCallback((authenticated: boolean) => {
    setAuthenticatedOverride(authenticated)
  }, [])

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

  const value = useMemo(
    () => ({
      ...appInfo,
      authenticated: authenticatedOverride ?? appInfo.authenticated,
      setAuthenticated,
    }),
    [appInfo, authenticatedOverride, setAuthenticated]
  )

  return (
    <AppInfoContext.Provider value={value}>{children}</AppInfoContext.Provider>
  )
}
