import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import { App } from "./App"
import { ScreenshotOverlay } from "./screenshot-overlay"
import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("页面根节点不存在")

const screenshotMode = window.location.hash === "#/screenshot"

createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {screenshotMode ? <ScreenshotOverlay /> : <App />}
    </MotionConfig>
  </StrictMode>,
)
