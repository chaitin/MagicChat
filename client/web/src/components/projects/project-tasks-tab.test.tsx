import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTasksTab } from "@/components/projects/project-tasks-tab"
import type { ProjectTask } from "@/components/projects/project-types"

const projectTaskApiMocks = vi.hoisted(() => ({
  getClientProjectTask: vi.fn(),
  listClientProjectTasks: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/project-task-data-api")>()
  return {
    ...original,
    getClientProjectTask: projectTaskApiMocks.getClientProjectTask,
    listClientProjectTasks: projectTaskApiMocks.listClientProjectTasks,
  }
})

vi.mock("@/lib/project-members", () => ({
  hydrateClientProjectMembers: (members: unknown[]) => members,
  listAllClientProjectMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/components/projects/project-task-details-dialog", () => ({
  ProjectTaskDetailsDialog: ({
    onDeleted,
    onOpenChange,
    onUpdated,
    task,
  }: {
    onDeleted?: (taskId: string) => void
    onOpenChange: (open: boolean) => void
    onUpdated?: () => Promise<void>
    task: ProjectTask
  }) => (
    <div aria-label="任务详情" role="dialog">
      <span>{task.title}</span>
      <input aria-label="评论草稿" defaultValue="" />
      <button onClick={() => void onUpdated?.()} type="button">
        模拟保存
      </button>
      <button onClick={() => onOpenChange(false)} type="button">
        关闭详情
      </button>
      <button
        onClick={() => {
          onOpenChange(false)
          onDeleted?.(task.id)
        }}
        type="button"
      >
        删除任务
      </button>
    </div>
  ),
}))

describe("ProjectTasksTab", () => {
  beforeEach(() => {
    window.localStorage.clear()
    projectTaskApiMocks.getClientProjectTask.mockReset()
    projectTaskApiMocks.listClientProjectTasks.mockReset()
  })

  it("loads todo and in-progress tasks by default", async () => {
    projectTaskApiMocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })

    renderProjectTasksTab("/projects/project-1")

    await waitFor(() => {
      expect(projectTaskApiMocks.listClientProjectTasks).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ statuses: ["todo", "in_progress"] })
      )
    })
  })

  it("opens a linked task after refresh and removes only taskId when closed", async () => {
    const user = userEvent.setup()
    const task = createProjectTask()
    projectTaskApiMocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })
    projectTaskApiMocks.getClientProjectTask.mockResolvedValue(task)

    renderProjectTasksTab("/projects/project-1?source=link&taskId=task-1")

    expect(
      await screen.findByRole("dialog", { name: "任务详情" })
    ).toHaveTextContent(task.title)
    expect(projectTaskApiMocks.getClientProjectTask).toHaveBeenCalledWith(
      "project-1",
      "task-1"
    )

    await user.click(screen.getByRole("button", { name: "关闭详情" }))

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "?source=link"
      )
    })
    expect(
      screen.queryByRole("dialog", { name: "任务详情" })
    ).not.toBeInTheDocument()
  })

  it("opens a task workspace in a new tab", async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const task = createProjectTask()
    projectTaskApiMocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [task],
    })

    renderProjectTasksTab("/projects/project-1?source=list")

    await user.click(
      await screen.findByRole("button", {
        name: `查看任务详情：${task.title}`,
      })
    )

    expect(open).toHaveBeenCalledWith(
      "/tasks/project-1/task-1",
      "_blank",
      "noopener,noreferrer"
    )
    expect(
      screen.queryByRole("dialog", { name: "任务详情" })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "?source=list"
    )
    open.mockRestore()
  })

  it("preserves detail state when the task updatedAt changes", async () => {
    const user = userEvent.setup()
    const task = createProjectTask()
    const updatedTask = {
      ...task,
      updatedAt: "2026-07-14T09:00:00Z",
    }
    projectTaskApiMocks.listClientProjectTasks
      .mockResolvedValueOnce({ nextCursor: null, tasks: [task] })
      .mockResolvedValue({ nextCursor: null, tasks: [updatedTask] })

    renderProjectTasksTab("/projects/project-1?taskId=task-1")

    const draft = await screen.findByRole("textbox", { name: "评论草稿" })
    await user.type(draft, "不要丢失")
    await user.click(screen.getByRole("button", { name: "模拟保存" }))

    await waitFor(() => {
      expect(projectTaskApiMocks.listClientProjectTasks).toHaveBeenCalledTimes(
        2
      )
    })
    expect(screen.getByRole("textbox", { name: "评论草稿" })).toHaveValue(
      "不要丢失"
    )
  })

  it("does not reload a task while its deleted details are closing", async () => {
    const user = userEvent.setup()
    const task = createProjectTask()
    projectTaskApiMocks.listClientProjectTasks
      .mockResolvedValueOnce({ nextCursor: null, tasks: [task] })
      .mockResolvedValue({ nextCursor: null, tasks: [] })

    renderProjectTasksTab("/projects/project-1?source=list&taskId=task-1")

    await user.click(await screen.findByRole("button", { name: "删除任务" }))

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "?source=list"
      )
    })
    expect(projectTaskApiMocks.getClientProjectTask).not.toHaveBeenCalled()
  })
})

function renderProjectTasksTab(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <>
              <ProjectTasksTab
                onTasksChanged={vi.fn().mockResolvedValue(undefined)}
                projectId="project-1"
              />
              <LocationSearch />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

function LocationSearch() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

function createProjectTask(): ProjectTask {
  const creator = {
    avatar: "",
    id: "user-1",
    name: "Creator",
    nickname: "创建人",
  }
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T01:00:00Z",
    creator,
    description: "任务描述",
    dueDate: "2026-07-20",
    id: "task-1",
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: "2026-07-14",
    status: "todo",
    title: "路由任务",
    updatedAt: "2026-07-14T01:00:00Z",
  }
}
