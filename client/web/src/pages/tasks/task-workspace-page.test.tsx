import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectTask } from "@/components/projects/project-types"
import { TaskWorkspacePage } from "@/pages/tasks/task-workspace-page"

const mocks = vi.hoisted(() => ({
  getClientProject: vi.fn(),
  getClientProjectTask: vi.fn(),
  listClientProjects: vi.fn(),
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-data-api", () => ({
  getClientProject: mocks.getClientProject,
  listClientProjects: mocks.listClientProjects,
}))

vi.mock("@/lib/project-task-data-api", () => ({
  getClientProjectTask: mocks.getClientProjectTask,
  listClientProjectTasks: mocks.listClientProjectTasks,
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: ({ task }: { task: ProjectTask }) => (
    <section aria-label="任务详情">详情：{task.title}</section>
  ),
}))

vi.mock("@/components/projects/create-project-task-dialog", () => ({
  CreateProjectTaskDialog: () => null,
}))

describe("TaskWorkspacePage", () => {
  beforeEach(() => {
    mocks.getClientProject.mockReset()
    mocks.getClientProject.mockResolvedValue(
      createProject("project-1", "发布项目")
    )
    mocks.getClientProjectTask.mockReset()
    mocks.listClientProjects.mockReset()
    mocks.listClientProjects.mockResolvedValue({
      nextCursor: null,
      personalProject: createProject("personal-project", "个人工作区", true),
      projects: [
        createProject("project-1", "发布项目"),
        createProject("project-2", "研发项目"),
      ],
    })
    mocks.listClientProjectTasks.mockReset()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [createTask()],
    })
  })

  it("uses the shared card workspace layout while preserving responsive panes", async () => {
    const { container } = renderWorkspace("/tasks/project-1")

    expect(await screen.findByText("发布任务")).toBeInTheDocument()
    expect(container.querySelector("main")).toHaveClass(
      "gap-3",
      "bg-muted",
      "p-3"
    )

    const taskList = screen.getByLabelText("任务列表工作区")
    expect(taskList).toHaveClass(
      "rounded-xl",
      "border",
      "bg-background",
      "shadow-xs",
      "flex",
      "md:flex"
    )
    expect(taskList).not.toHaveClass("border-r")

    const taskContent = screen.getByLabelText("任务内容工作区")
    expect(taskContent).toHaveClass(
      "rounded-xl",
      "border",
      "bg-background",
      "shadow-xs",
      "hidden",
      "md:flex"
    )
  })

  it("renders the status and priority filters as an equal-width row", async () => {
    renderWorkspace("/tasks/project-1")

    await screen.findByText("发布任务")
    const filters = screen.getByLabelText("任务筛选")
    expect(filters).toHaveClass("grid", "grid-cols-2", "gap-2")
    expect(screen.getByRole("button", { name: "全部状态" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "全部优先级" })
    ).toBeInTheDocument()
  })

  it("combines status, priority, and keyword filters and supports clearing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderWorkspace("/tasks/project-1")
    await screen.findByText("发布任务")

    const statusTrigger = screen.getByRole("button", { name: "全部状态" })
    await user.click(statusTrigger)
    await user.click(screen.getByRole("menuitemcheckbox", { name: "进行中" }))
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [], statuses: ["in_progress"] })
      )
    )

    await user.click(screen.getByRole("menuitemcheckbox", { name: "进行中" }))
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [], statuses: [] })
      )
    )
    await user.click(statusTrigger)
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
  })

  it("combines priority and keyword filters and supports clearing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderWorkspace("/tasks/project-1")
    await screen.findByText("发布任务")

    const priorityTrigger = screen.getByRole("button", {
      name: "全部优先级",
    })
    await user.click(priorityTrigger)
    await user.click(screen.getByRole("menuitemcheckbox", { name: "高" }))
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({ priorities: [3], statuses: [] })
      )
    )
    await user.click(priorityTrigger)
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )

    const search = screen.getByRole("textbox", { name: "搜索任务" })
    await user.click(search)
    await user.paste("发布")
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({
          keyword: "发布",
          priorities: [3],
          statuses: [],
        })
      )
    )
    await user.clear(search)
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({
          keyword: undefined,
          priorities: [3],
          statuses: [],
        })
      )
    )

    await user.click(screen.getByRole("button", { name: /优先级：高/ }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "高" }))
    await waitFor(() =>
      expect(mocks.listClientProjectTasks).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({
          keyword: undefined,
          priorities: [],
          statuses: [],
        })
      )
    )
    await user.click(priorityTrigger)
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
  })

  it("keeps the task list visible and opens details through the route", async () => {
    const user = userEvent.setup()
    renderWorkspace("/tasks/project-1")

    expect(await screen.findByText("发布任务")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "切换项目" })).toHaveTextContent(
      "发布项目"
    )

    await user.click(screen.getByRole("button", { name: /发布任务/ }))

    expect(await screen.findByLabelText("任务详情")).toHaveTextContent(
      "详情：发布任务"
    )
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/tasks/project-1/task-1"
    )
    expect(screen.getByLabelText("任务列表工作区")).toHaveClass(
      "hidden",
      "md:flex"
    )
    expect(screen.getByLabelText("任务内容工作区")).toHaveClass(
      "flex",
      "md:flex"
    )
  })

  it("shows project avatars in the dropdown and navigates on selection", async () => {
    const user = userEvent.setup()
    renderWorkspace("/tasks/project-1")

    const trigger = await screen.findByRole("button", { name: "切换项目" })
    expect(trigger.querySelector("svg")).toBeInTheDocument()
    await user.click(trigger)

    const option = await screen.findByRole("menuitemradio", {
      name: /研发项目/,
    })
    expect(option.querySelector("svg")).toBeInTheDocument()
    await user.click(option)

    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/project-2")
  })

  it("loads a deep-linked task that is not in the first list page", async () => {
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })
    mocks.getClientProjectTask.mockResolvedValue(createTask())

    renderWorkspace("/tasks/project-1/task-1")

    expect(await screen.findByLabelText("任务详情")).toHaveTextContent(
      "详情：发布任务"
    )
    await waitFor(() => {
      expect(mocks.getClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1"
      )
    })
  })
})

function renderWorkspace(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/tasks/:projectId/:taskId?"
          element={
            <>
              <TaskWorkspacePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
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

function createTask(): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    description: "",
    dueDate: null,
    id: "task-1",
    labels: [],
    priority: 2,
    projectId: "project-1",
    reminder: null,
    startDate: null,
    status: "todo",
    title: "发布任务",
    updatedAt: "2026-07-14T08:00:00Z",
  }
}
