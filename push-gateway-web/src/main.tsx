import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "./index.css"
import App from "./App"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <ThemeProvider storageKey="magicchat-push-gateway-theme">
        <App />
        <Toaster position="top-center" />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
)
