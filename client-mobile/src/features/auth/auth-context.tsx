import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import { useQueryClient } from "@tanstack/react-query"

import { logout } from "@/data/auth-api"
import type { AuthenticatedTarget } from "@/data/query"
import { clearSessionData } from "@/data/session-cache"

export type AuthSession = AuthenticatedTarget

type AuthContextValue = {
  invalidateSession: () => Promise<void>
  isAuthenticated: boolean
  isSigningOut: boolean
  session: AuthSession | null
  signIn: (session: AuthSession) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const sessionRef = useRef<AuthSession | null>(null)
  const signOutPromiseRef = useRef<Promise<void> | null>(null)
  const signIn = useCallback((nextSession: AuthSession) => {
    sessionRef.current = nextSession
    setSession(nextSession)
  }, [])

  const invalidateSession = useCallback(async () => {
    const currentSession = sessionRef.current

    sessionRef.current = null
    setSession(null)

    if (currentSession) {
      await clearSessionData(queryClient, currentSession)
    }
  }, [queryClient])

  const signOut = useCallback(() => {
    if (signOutPromiseRef.current) {
      return signOutPromiseRef.current
    }

    const currentSession = sessionRef.current
    if (!currentSession) {
      return Promise.resolve()
    }

    setIsSigningOut(true)
    const operation = logout(currentSession.url)
      .then(async () => {
        if (sessionRef.current === currentSession) {
          await invalidateSession()
        }
      })
      .finally(() => {
        signOutPromiseRef.current = null
        setIsSigningOut(false)
      })

    signOutPromiseRef.current = operation
    return operation
  }, [invalidateSession])

  const value = useMemo(
    () => ({
      invalidateSession,
      isAuthenticated: session !== null,
      isSigningOut,
      session,
      signIn,
      signOut,
    }),
    [invalidateSession, isSigningOut, session, signIn, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error("useAuth 必须在 AuthProvider 内使用")
  }

  return value
}

export function useAuthenticatedSession() {
  const { session } = useAuth()

  if (!session) {
    throw new Error("当前页面需要已认证的用户会话")
  }

  return session
}
