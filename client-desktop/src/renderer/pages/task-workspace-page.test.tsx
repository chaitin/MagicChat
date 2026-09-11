import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TaskWorkspacePage } from "@/pages/task-workspace-page"
import type { ProjectTask } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  getClientProject: vi.fn(),
  getClientProjectTask: vi.fn(),
  listClientProjects: vi.fn(),
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-data-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-data-api")>()
  return {
    ...original,
    getClientProject: mocks.getClientProject,
    listClientProjects: mocks.listClientProjects,
  }
})

vi.mock("@/lib/project-task-data-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/project-task-data-api")>()
  return {
    ...original,
    getClientProjectTask: mocks.getClientProjectTask,
    listClientProjectTasks: mocks.listClientProjectTasks,
  }
})

vi.mock("@/components/projects/create-project-task-dialog", () => ({
  CreateProjectTaskDialog: () => null,
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: ({ onUpdated }: { onUpdated?: () => Promise<void> | void }) => (
    <button onClick={() => void onUpdated?.()} type="button">
      触发任务更新
    </button>
  ),
}))

describe("TaskWorkspacePage", () => {
  beforeEach(() => {
    mocks.getClientProject.mockReset().mockRejectedValue(new Error("not needed"))
    mocks.getClientProjectTask.mockReset()
    mocks.listClientProjects.mockReset().mockResolvedValue({
      nextCursor: null,
      personalProject: null,
      projects: [],
    })
    mocks.listClientProjectTasks.mockReset()
  })

  it("does not append a stale pagination response after the search query changes", async () => {
    const user = userEvent.setup()
    const loadMore = deferred<TaskPage>()
    const search = deferred<TaskPage>()
    mocks.listClientProjectTasks.mockImplementation(
      (_projectId: string, options: { cursor?: string; keyword?: string }) => {
        if (options.cursor) return loadMore.promise
        if (options.keyword === "新搜索") return search.promise
        return Promise.resolve({
          nextCursor: "cursor-old",
          tasks: [createTask("old-first", "旧结果")],
        })
      },
    )

    renderTaskWorkspace()

    expect(await screen.findByText("旧结果")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "加载更多" }))
    await user.type(screen.getByRole("textbox", { name: "搜索任务内容" }), "新搜索")

    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ keyword: "新搜索" }),
      ),
    )
    search.resolve({ nextCursor: null, tasks: [createTask("new-result", "新结果")] })
    expect(await screen.findByText("新结果")).toBeInTheDocument()

    loadMore.resolve({ nextCursor: null, tasks: [createTask("old-more", "旧分页结果")] })
    await waitFor(() => expect(screen.queryByText("旧分页结果")).not.toBeInTheDocument())
  })

  it("sends selected status and priority filters to the task list request", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTasks.mockResolvedValue({ nextCursor: null, tasks: [] })

    renderTaskWorkspace()

    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [], statuses: [] }),
      ),
    )

    await user.click(await screen.findByRole("button", { name: "全部状态" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: /进行中/ }))
    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [], statuses: ["in_progress"] }),
      ),
    )

    await user.click(screen.getByRole("button", { name: "全部优先级" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: /高/ }))

    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [3], statuses: ["in_progress"] }),
      ),
    )
  })

  it("refreshes the active task detail after a task update and keeps the dialog open on refresh failure", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("other-task", "其他任务")],
    })
    mocks.getClientProjectTask.mockResolvedValue(createTask("deep-task", "深链任务"))

    renderTaskWorkspace("/tasks/project-1/deep-task")

    expect(await screen.findByRole("button", { name: "触发任务更新" })).toBeInTheDocument()
    expect(mocks.getClientProjectTask).toHaveBeenCalledWith("project-1", "deep-task")

    mocks.getClientProjectTask.mockRejectedValue(new Error("refresh failed"))
    await user.click(screen.getByRole("button", { name: "触发任务更新" }))

    await waitFor(() => expect(mocks.getClientProjectTask).toHaveBeenCalledTimes(2))
    expect(screen.getByRole("button", { name: "触发任务更新" })).toBeInTheDocument()
  })

  it("refetches a deep-linked task after visiting a task already in the list", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("listed-task", "列表任务")],
    })
    mocks.getClientProjectTask
      .mockResolvedValueOnce(createTask("deep-task", "旧的深链任务"))
      .mockResolvedValueOnce(createTask("deep-task", "刷新的深链任务"))

    renderTaskWorkspaceWithNavigation("/tasks/project-1/deep-task")

    await waitFor(() => expect(mocks.getClientProjectTask).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole("button", { name: "打开列表任务" }))
    expect(await screen.findByText("列表任务")).toBeInTheDocument()
    expect(mocks.getClientProjectTask).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "返回深链任务" }))
    await waitFor(() => expect(mocks.getClientProjectTask).toHaveBeenCalledTimes(2))
  })

  it("uses the shared card workspace layout while preserving responsive panes", async () => {
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("task-1", "发布任务")],
    })
    const { container } = renderTaskWorkspace()

    expect(await screen.findByText("发布任务")).toBeInTheDocument()
    expect(container.querySelector("main")).toHaveClass("gap-3", "bg-muted", "p-3", "pt-10")

    const taskList = screen.getByLabelText("任务列表工作区")
    expect(taskList).toHaveClass("rounded-xl", "border", "bg-background", "shadow-xs")
    expect(taskList).not.toHaveClass("border-r")

    const taskContent = screen.getByLabelText("任务内容工作区")
    expect(taskContent).toHaveClass("rounded-xl", "border", "bg-background", "shadow-xs", "hidden")
  })

  it("shows project avatars in the dropdown and navigates on selection", async () => {
    const user = userEvent.setup()
    mocks.getClientProject.mockResolvedValue(createProject("project-1", "发布项目"))
    mocks.listClientProjects.mockResolvedValue({
      nextCursor: null,
      personalProject: null,
      projects: [createProject("project-1", "发布项目"), createProject("project-2", "研发项目")],
    })
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("task-1", "发布任务")],
    })

    render(
      <MemoryRouter initialEntries={["/tasks/project-1"]}>
        <Routes>
          <Route
            element={
              <>
                <TaskWorkspacePage />
                <CurrentPath />
              </>
            }
            path="/tasks/:projectId/:taskId?"
          />
        </Routes>
      </MemoryRouter>,
    )

    const trigger = await screen.findByRole("button", { name: "切换项目" })
    expect(trigger).toHaveTextContent("发布项目")
    expect(trigger.querySelector("svg")).toBeInTheDocument()
    await user.click(trigger)

    const option = await screen.findByRole("menuitemradio", { name: /研发项目/ })
    expect(option.querySelector("svg")).toBeInTheDocument()
    await user.click(option)

    expect(screen.getByTestId("current-path")).toHaveTextContent("/tasks/project-2")
  })

  it("returns to chat from the task workspace", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask("task-1", "任务一")],
    })

    renderTaskWorkspace()

    expect(await screen.findByText("任务一")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "返回聊天" }))

    expect(screen.getByTestId("current-path")).toHaveTextContent("/chat")
  })
})

type TaskPage = {
  nextCursor: string | null
  tasks: ProjectTask[]
}

function renderTaskWorkspace(initialEntry = "/tasks/project-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<TaskWorkspacePage />} path="/tasks/:projectId/:taskId?" />
        <Route element={<CurrentPath />} path="/chat" />
      </Routes>
    </MemoryRouter>,
  )
}

function renderTaskWorkspaceWithNavigation(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TaskNavigation />
      <Routes>
        <Route element={<TaskWorkspacePage />} path="/tasks/:projectId/:taskId?" />
      </Routes>
    </MemoryRouter>,
  )
}

function TaskNavigation() {
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => navigate("/tasks/project-1/listed-task")} type="button">
        打开列表任务
      </button>
      <button onClick={() => navigate("/tasks/project-1/deep-task")} type="button">
        返回深链任务
      </button>
    </div>
  )
}

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

function createProject(id: string, name: string, isPersonal = false) {
  return {
    avatar: "",
    description: "",
    id,
    isPersonal,
    name,
    updatedAt: "2026-07-14T08:00:00Z",
  }
}

function createTask(id: string, title: string): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    description: "",
    dueDate: null,
    id,
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: null,
    status: "todo",
    title,
    updatedAt: "2026-07-14T08:00:00Z",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
