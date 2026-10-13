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
const ProjectTaskWindowPage = lazy(() =>
  import("./features/projects/project-task-window-page").then(({ ProjectTaskWindowPage }) => ({
    default: ProjectTaskWindowPage,
  })),
)

export function AppPages({
  mediaPreviewMode,
  taskWindowMode,
}: {
  mediaPreviewMode: boolean
  taskWindowMode: boolean
}) {
  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={null}>
        {taskWindowMode ? (
          <AnimatedToastProvider>
            <ProjectTaskWindowPage />
          </AnimatedToastProvider>
        ) : mediaPreviewMode ? (
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
