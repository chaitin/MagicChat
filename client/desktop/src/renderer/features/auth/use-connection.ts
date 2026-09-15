import { useCallback, useEffect, useRef, useState } from "react"
import {
  OFFICIAL_SERVER_ID,
  OFFICIAL_SERVER_URL,
  type AuthProblem,
  type AuthResult,
  type Connection,
  type ServerCatalog,
  type ServerProfile,
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
  lastEmail: "",
  user: null,
  info: {
    appName: "即应",
    organizationName: "你的团队",
    emailCodeLoginEnabled: true,
    passwordLoginEnabled: true,
    thirdPartyProviders: [{ key: "oidc", name: "通用 OIDC" }],
  },
}
const bridgeError: AuthProblem = { code: "bridge", message: "桌面服务暂不可用，请重启客户端后再试" }

export function useConnection() {
  const [catalog, setCatalog] = useState<ServerCatalog>(previewCatalog)
  const [server, setServer] = useState<ServerProfile>(official)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<AuthProblem | null>(null)
  const [loading, setLoading] = useState(true)
  const initial = useRef<Promise<AuthResult<ServerCatalog>> | null>(null)
  const connecting = useRef(false)
  const isPreview = !window.desktop

  const accept = useCallback((connected: Connection) => {
    setServer(connected.server)
    setCatalog((value) => ({ ...value, activeServerId: connected.server.id }))
    setConnection(connected)
    setError(null)
    setLoading(false)
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

  useEffect(() => {
    let cancelled = false
    // StrictMode 的 effect 会重放，复用同一个启动请求，避免重复读取配置。
    initial.current ??= (
      window.desktop
        ? window.desktop.auth.getServers()
        : Promise.resolve({ ok: true, data: previewCatalog } as const)
    ).catch(() => ({ ok: false, error: bridgeError }) as const)
    void initial.current.then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) acceptCatalog(result.data)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [acceptCatalog])

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
    acceptCatalog,
    connect,
    clearError,
    retry,
  }
}
