import { Suspense, lazy } from "react"
import { MotionConfig } from "motion/react"
import { AnimatedToastProvider } from "./components/motion/animated-toast-provider"
import { NotificationPermissionProvider } from "./notification-permission-provider"

const App = lazy(() => import("./App").then(({ App }) => ({ default: App })))
const MediaPreviewPage = lazy(() =>
  import("./features/media-preview/media-preview-page").then(({ MediaPreviewPage }) => ({
    default: MediaPreviewPage,
  })),
)

export function AppPages({ mediaPreviewMode }: { mediaPreviewMode: boolean }) {
  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={null}>
        {mediaPreviewMode ? (
          <AnimatedToastProvider>
            <MediaPreviewPage />
          </AnimatedToastProvider>
        ) : (
          <NotificationPermissionProvider>
            <App />
          </NotificationPermissionProvider>
        )}
      </Suspense>
    </MotionConfig>
  )
}
