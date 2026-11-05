import { Component, type ReactNode } from "react"
import { WindowTitleBar } from "./components/window-title-bar"

function TaskWindowShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <WindowTitleBar brandTitle="任务" controls={window.taskWindow?.windowControls} />
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
        {children}
      </main>
    </div>
  )
}

export function TaskWindowLoading() {
  return (
    <TaskWindowShell>
      <p role="status">正在打开任务…</p>
    </TaskWindowShell>
  )
}

export class TaskWindowStartupBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // 错误页已可交互，避免主进程仍把它当作未启动的空白窗口。
    void window.taskWindow?.initialize().catch(() => undefined)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <TaskWindowShell>
        <p role="alert">任务窗口加载失败，请重新加载。</p>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </TaskWindowShell>
    )
  }
}
