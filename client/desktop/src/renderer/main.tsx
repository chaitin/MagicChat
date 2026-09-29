import { StrictMode, Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
import { ScreenshotOverlay } from "./screenshot-overlay"
import "./styles.css"

const AppPages = lazy(() => import("./app-pages").then(({ AppPages }) => ({ default: AppPages })))

const root = document.getElementById("root")
if (!root) throw new Error("页面根节点不存在")

const screenshotMode = window.location.hash === "#/screenshot"
const mediaPreviewMode = window.location.hash === "#/media-preview"

createRoot(root).render(
  <StrictMode>
    {screenshotMode ? (
      <ScreenshotOverlay />
    ) : (
      <Suspense fallback={null}>
        <AppPages mediaPreviewMode={mediaPreviewMode} />
      </Suspense>
    )}
  </StrictMode>,
)
