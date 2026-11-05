import { useCallback, useEffect, useRef, useState } from "react"
import {
  OFFICIAL_SERVER_ID,
  OFFICIAL_SERVER_URL,
  type AuthProblem,
  type AuthResult,
  type AuthUser,
  type Connection,
  type ServerCatalog,
  type ServerProfile,
  type RestoredSession,
} from "../../../shared/auth"

const official: ServerProfile = {
  id: OFFICIAL_SERVER_ID,
  name: "演示服务器",
  url: OFFICIAL_SERVER_URL,
  builtin: true,
}
const previewCatalog: ServerCatalog = { activeServerId: OFFICIAL_SERVER_ID, servers: [official] }
const preview: Connection = {
  targetId: "browser-preview",
  server: official,
  user: null,
  info: {
    appName: "即应",
    organizationName: "你的团队",
    emailCodeLoginEnabled: true,
    passwordLoginEnabled: true,
    thirdPartyProviders: [{ key: "oidc", name: "通用 OIDC" }],
  },
}
const bridgeError: AuthProblem = { code: "bridge", message: "桌面服务暂不可用，请稍后重试" }

export function useConnection() {
  const [catalog, setCatalog] = useState<ServerCatalog>(() =>
    window.desktop ? { activeServerId: OFFICIAL_SERVER_ID, servers: [] } : previewCatalog,
  )
  const [server, setServer] = useState<ServerProfile>(official)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<AuthProblem | null>(null)
  const [loading, setLoading] = useState(true)
  const initial = useRef<{
    catalog: Promise<AuthResult<ServerCatalog>>
    session: Promise<AuthResult<RestoredSession>>
  } | null>(null)
  const catalogRequest = useRef<Promise<AuthResult<ServerCatalog>> | null>(null)
  const connecting = useRef(false)
  const isPreview = !window.desktop

  const accept = useCallback((connected: Connection) => {
    setServer(connected.server)
    setCatalog((value) => ({ ...value, activeServerId: connected.server.id }))
    setConnection(connected)
    setError(null)
    setLoading(false)
  }, [])

  const acceptUser = useCallback((user: AuthUser) => {
    setConnection((current) => (current?.user?.id === user.id ? { ...current, user } : current))
  }, [])

  const acceptCatalog = useCallback((next: ServerCatalog) => {
    setCatalog(next)
    const active = next.servers.find((item) => item.id === next.activeServerId)
    if (!active) return
    setServer(active)
    setConnection((value) =>
      value?.server.id === active.id ? { ...value, server: active } : value,
    )
  }, [])

  const readCatalog = useCallback((): Promise<AuthResult<ServerCatalog>> => {
    catalogRequest.current ??= (async () => {
      for (let attempt = 0; ; attempt++) {
        let result: AuthResult<ServerCatalog>
        try {
          result = window.desktop
            ? await window.desktop.auth.getServers()
            : { ok: true, data: previewCatalog }
        } catch {
          result = { ok: false, error: bridgeError }
        }
        if (result.ok || attempt >= 2 || !["bridge", "busy"].includes(result.error.code)) {
          return result
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    })().finally(() => {
      catalogRequest.current = null
    })
    return catalogRequest.current
  }, [])

  useEffect(() => {
    let cancelled = false
    // StrictMode 重放共享启动请求；本地列表不能依赖联网恢复成功。
    const requests = (initial.current ??= {
      catalog: readCatalog(),
      session: Promise.resolve()
        .then(() =>
          window.desktop
            ? window.desktop.auth.restoreLastSession()
            : ({ ok: true, data: { catalog: previewCatalog, connection: null } } as const),
        )
        .catch(() => ({ ok: false, error: bridgeError }) as const),
    })
    void requests.catalog.then((result) => {
      if (!cancelled && result.ok) acceptCatalog(result.data)
    })
    void Promise.all([requests.catalog, requests.session]).then(([local, restored]) => {
      if (cancelled) return
      setLoading(false)
      if (!restored.ok) {
        setError(local.ok ? restored.error : local.error)
        return
      }
      // 恢复结果可能更新当前服务器，必须在本地快照之后提交。
      acceptCatalog(restored.data.catalog)
      if (restored.data.connection) accept(restored.data.connection)
      else setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [accept, acceptCatalog, readCatalog])

  const reloadCatalog = useCallback(async (): Promise<AuthResult<ServerCatalog>> => {
    if (connecting.current) {
      return { ok: false, error: { code: "busy", message: "正在连接服务器，请稍候" } }
    }
    setLoading(true)
    setError(null)
    try {
      const result = await readCatalog()
      if (result.ok) acceptCatalog(result.data)
      else setError(result.error)
      return result
    } finally {
      setLoading(false)
    }
  }, [acceptCatalog, readCatalog])

  const connect = useCallback(
    async (serverId: string): Promise<AuthResult<Connection>> => {
      if (connecting.current) {
        return { ok: false, error: { code: "busy", message: "正在连接服务器，请稍候" } }
      }
      const selected = catalog.servers.find((item) => item.id === serverId)
      if (!selected) {
        return { ok: false, error: { code: "invalid_server", message: "服务器不存在或已被删除" } }
      }
      connecting.current = true
      setServer(selected)
      setLoading(true)
      setError(null)
      try {
        const result = window.desktop
          ? await window.desktop.auth.connect(serverId)
          : serverId === OFFICIAL_SERVER_ID
            ? ({ ok: true, data: preview } as const)
            : ({ ok: false, error: bridgeError } as const)
        if (result.ok) accept(result.data)
        else {
          setConnection(null)
          setError(result.error)
        }
        return result
      } catch {
        setConnection(null)
        setError(bridgeError)
        return { ok: false, error: bridgeError }
      } finally {
        connecting.current = false
        setLoading(false)
      }
    },
    [accept, catalog.servers],
  )

  async function retry() {
    await connect(server.id)
  }

  function clearError() {
    setError(null)
  }

  return {
    server,
    catalog,
    connection,
    error,
    loading,
    isPreview,
    accept,
    acceptUser,
    acceptCatalog,
    reloadCatalog,
    connect,
    clearError,
    retry,
  }
}
