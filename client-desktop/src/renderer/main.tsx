import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/styles/index.css"
import "./styles.css"
import "./styles/desktop-workspace.css"
import { DesktopRoot } from "./desktop-root"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopRoot />
  </StrictMode>,
)
