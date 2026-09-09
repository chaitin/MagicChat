import { useState } from "react"
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"

import Console from "@/console"
import { isAuthenticated, logout } from "@/lib/auth"
import { defaultConsolePage } from "@/lib/console-pages"
import LoginPage from "@/pages/login-page"
import ServersPage from "@/pages/servers-page"

export function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated)

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
        logout()
        onLogout()
        navigate("/login", { replace: true })
      }}
    />
  )
}

export default App
