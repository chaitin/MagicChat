import { useEffect, useState } from "react"
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"

import Console from "@/console"
import { checkSession, logout } from "@/lib/auth"
import { defaultConsolePage } from "@/lib/console-pages"
import LoginPage from "@/pages/login-page"
import ServersPage from "@/pages/servers-page"

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const handleUnauthorized = () => setAuthenticated(false)
    window.addEventListener(
      "push-gateway-admin-unauthorized",
      handleUnauthorized
    )
    void checkSession().then((value) => {
      if (active) setAuthenticated(value)
    })
    return () => {
      active = false
      window.removeEventListener(
        "push-gateway-admin-unauthorized",
        handleUnauthorized
      )
    }
  }, [])

  if (authenticated === null) {
    return <main className="min-h-svh bg-background" />
  }

  return (
    <Routes>
      <Route
        element={
          <LoginPage
            authenticated={authenticated}
            onLogin={() => setAuthenticated(true)}
          />
        }
        path="/login"
      />
      <Route
        element={
          <ProtectedConsole
            authenticated={authenticated}
            onLogout={() => setAuthenticated(false)}
          />
        }
        path="/"
      >
        <Route element={<Navigate replace to={defaultConsolePage} />} index />
        <Route element={<ServersPage />} path="servers" />
      </Route>
      <Route
        element={
          <Navigate
            replace
            to={authenticated ? defaultConsolePage : "/login"}
          />
        }
        path="*"
      />
    </Routes>
  )
}

function ProtectedConsole({
  authenticated,
  onLogout,
}: {
  authenticated: boolean
  onLogout: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()

  if (!authenticated) {
    return (
      <Navigate
        replace
        state={{
          from: { pathname: location.pathname, search: location.search },
        }}
        to="/login"
      />
    )
  }

  return (
    <Console
      onLogout={() => {
        void logout()
        onLogout()
        navigate("/login", { replace: true })
      }}
    />
  )
}

export default App
