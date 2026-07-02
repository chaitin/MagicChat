import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router"

import {
  ClientDataRequestError,
  getCurrentClientUser,
  listClientContacts,
  type ClientUser,
  type ContactUser,
} from "@/lib/client-data-api"
import {
  ClientDataContext,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import { Button } from "@/components/ui/button"

type BootstrapState = "loading" | "ready" | "error"

const minimumBootstrapLoadingMs = 2_000
const refreshIntervalMs = 60_000

export function ClientDataProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [bootstrapError, setBootstrapError] =
    useState<ClientDataRequestError | null>(null)
  const [bootstrapState, setBootstrapState] =
    useState<BootstrapState>("loading")
  const [contacts, setContacts] = useState<ContactUser[]>([])
  const [contactsError, setContactsError] =
    useState<ClientDataRequestError | null>(null)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsRefreshing, setContactsRefreshing] = useState(false)
  const [me, setMe] = useState<ClientUser | null>(null)
  const [meError, setMeError] = useState<ClientDataRequestError | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [meRefreshing, setMeRefreshing] = useState(false)

  const handleError = useCallback(
    (error: unknown, fallbackMessage: string) => {
      const requestError =
        error instanceof ClientDataRequestError
          ? error
          : new ClientDataRequestError(fallbackMessage)

      if (requestError.status === 401 || requestError.code === "unauthorized") {
        setContacts([])
        setMe(null)
        navigate("/login", { replace: true })
      }

      return requestError
    },
    [navigate]
  )

  const refreshMe = useCallback(async () => {
    const isInitialLoad = me === null
    setMeError(null)
    setMeLoading(isInitialLoad)
    setMeRefreshing(!isInitialLoad)

    try {
      setMe(await getCurrentClientUser())
    } catch (error) {
      const requestError = handleError(error, "加载当前用户失败")
      setMeError(requestError)
      throw requestError
    } finally {
      setMeLoading(false)
      setMeRefreshing(false)
    }
  }, [handleError, me])

  const refreshContacts = useCallback(async () => {
    const isInitialLoad = contacts.length === 0
    setContactsError(null)
    setContactsLoading(isInitialLoad)
    setContactsRefreshing(!isInitialLoad)

    try {
      setContacts(await listClientContacts())
    } catch (error) {
      const requestError = handleError(error, "加载通讯录失败")
      setContactsError(requestError)
      throw requestError
    } finally {
      setContactsLoading(false)
      setContactsRefreshing(false)
    }
  }, [contacts.length, handleError])

  const bootstrap = useCallback(async () => {
    const minimumLoading = wait(minimumBootstrapLoadingMs)

    try {
      const [nextMe, nextContacts] = await Promise.all([
        getCurrentClientUser(),
        listClientContacts(),
      ])

      await minimumLoading
      setMe(nextMe)
      setContacts(nextContacts)
      setBootstrapState("ready")
    } catch (error) {
      const requestError = handleError(error, "加载工作区失败")

      if (requestError.status !== 401 && requestError.code !== "unauthorized") {
        await minimumLoading
      }

      setBootstrapError(requestError)
      setBootstrapState("error")
    } finally {
      setMeLoading(false)
      setContactsLoading(false)
    }
  }, [handleError])

  const retryBootstrap = useCallback(async () => {
    setBootstrapError(null)
    setBootstrapState("loading")
    setContactsError(null)
    setContactsLoading(true)
    setContactsRefreshing(false)
    setMeError(null)
    setMeLoading(true)
    setMeRefreshing(false)

    await bootstrap()
  }, [bootstrap])

  useEffect(() => {
    let active = true

    void Promise.resolve().then(() => {
      if (active) {
        return bootstrap()
      }

      return undefined
    })

    return () => {
      active = false
    }
  }, [bootstrap])

  useEffect(() => {
    if (bootstrapState !== "ready") {
      return
    }

    function refresh() {
      void refreshMe().catch(() => undefined)
      void refreshContacts().catch(() => undefined)
    }

    const interval = window.setInterval(refresh, refreshIntervalMs)

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refresh()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [bootstrapState, refreshContacts, refreshMe])

  const value = useMemo<ClientDataContextValue | null>(() => {
    if (!me) {
      return null
    }

    return {
      contacts,
      contactsError,
      contactsLoading,
      contactsRefreshing,
      me,
      meError,
      meLoading,
      meRefreshing,
      refreshContacts,
      refreshMe,
    }
  }, [
    contacts,
    contactsError,
    contactsLoading,
    contactsRefreshing,
    me,
    meError,
    meLoading,
    meRefreshing,
    refreshContacts,
    refreshMe,
  ])

  if (bootstrapState === "loading") {
    return <ClientDataLoadingPage />
  }

  if (bootstrapState === "error") {
    return (
      <ClientDataErrorPage
        message={bootstrapError?.message ?? "加载工作区失败"}
        onRetry={() => void retryBootstrap()}
      />
    )
  }

  if (!value) {
    return <ClientDataLoadingPage />
  }

  return (
    <ClientDataContext.Provider value={value}>
      {children}
    </ClientDataContext.Provider>
  )
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function ClientDataLoadingPage() {
  return (
    <div className="flex h-svh items-center justify-center bg-background text-foreground">
      <div className="flex w-56 flex-col items-center gap-3">
        <div className="text-sm text-muted-foreground">正在为你加载数据</div>
        <div
          aria-label="加载进度"
          aria-valuetext="加载中"
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div className="client-loading-progress-indicator h-full w-1/3 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  )
}

function ClientDataErrorPage({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-svh items-center justify-center bg-background px-4 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-base font-medium">工作区加载失败</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry} type="button" variant="outline">
          重试
        </Button>
      </div>
    </div>
  )
}
