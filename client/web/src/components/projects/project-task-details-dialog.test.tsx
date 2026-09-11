import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import type { ProjectTask } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  addClientProjectTaskComment: vi.fn(),
  deleteClientProjectTask: vi.fn(),
  getClientProjectTask: vi.fn(),
  listAllClientProjectMembers: vi.fn(),
  listClientProjectTaskActivities: vi.fn(),
  listClientProjectTasks: vi.fn(),
  sendConversationCard: vi.fn(),
  updateClientProjectTask: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", () => ({
  addClientProjectTaskComment: mocks.addClientProjectTaskComment,
  deleteClientProjectTask: mocks.deleteClientProjectTask,
  getClientProjectTask: mocks.getClientProjectTask,
  listClientProjectTaskActivities: mocks.listClientProjectTaskActivities,
  listClientProjectTasks: mocks.listClientProjectTasks,
  updateClientProjectTask: mocks.updateClientProjectTask,
}))

vi.mock("@/lib/project-members", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/project-members")>()
  return {
    ...original,
    listAllClientProjectMembers: mocks.listAllClientProjectMembers,
  }
})

vi.mock("@/lib/client-data-context", () => ({
  useOptionalClientData: () => null,
  useClientUsers: () => new Map(),
  useClientData: () => ({
    conversations: [
      {
        avatar: "",
        id: "conversation-1",
        name: "设计群",
        type: "group",
      },
    ],
    sendConversationCard: mocks.sendConversationCard,
  }),
}))

describe("ProjectTaskDetailsDialog card message", () => {
  beforeEach(() => {
    const task = createTask()
    mocks.addClientProjectTaskComment.mockReset()
    mocks.deleteClientProjectTask.mockReset()
    mocks.deleteClientProjectTask.mockResolvedValue(task.id)
    mocks.getClientProjectTask.mockReset()
    mocks.getClientProjectTask.mockResolvedValue(task)
    mocks.listAllClientProjectMembers.mockReset()
    mocks.listAllClientProjectMembers.mockResolvedValue([])
    mocks.listClientProjectTaskActivities.mockReset()
    mocks.listClientProjectTaskActivities.mockResolvedValue({
      activities: [],
      nextCursor: null,
    })
    mocks.listClientProjectTasks.mockReset()
    mocks.listClientProjectTasks.mockResolvedValue({
      nextCursor: null,
      tasks: [],
    })
    mocks.sendConversationCard.mockReset()
    mocks.sendConversationCard.mockResolvedValue({
      id: "message-1",
    })
    mocks.updateClientProjectTask.mockReset()
    mocks.updateClientProjectTask.mockResolvedValue(task)
  })

  it("renders inline without an overlay in embedded mode", async () => {
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          embedded
          onOpenChange={vi.fn()}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("dialog", { name: "任务标题" })
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    expect(
      screen.getByRole("button", { name: "返回任务列表" })
    ).toBeInTheDocument()
  })

  it("collapses activities before the latest twenty until expanded", async () => {
    const user = userEvent.setup()
    mocks.listClientProjectTaskActivities.mockResolvedValueOnce({
      activities: Array.from({ length: 21 }, (_, index) => ({
        actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
        changes: [],
        content: `动态 ${index + 1}`,
        createdAt: `2026-07-14T09:${String(index).padStart(2, "0")}:00Z`,
        id: `activity-${index + 1}`,
        projectId: "project-1",
        taskId: "task-1",
        type: "commented" as const,
      })),
      nextCursor: null,
    })

    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onOpenChange={vi.fn()}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    expect(await screen.findByText("动态 21")).toBeInTheDocument()
    expect(screen.queryByText("动态 1")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "展开更早动态" }))
    expect(screen.getByText("动态 1")).toBeInTheDocument()
    expect(mocks.listClientProjectTaskActivities).toHaveBeenCalledOnce()
  })

  it("keeps the embedded workspace open when a nested action opens", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          embedded
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const moreButton = await screen.findByRole("button", {
      name: "更多任务操作",
    })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }))

    expect(
      screen.getByRole("alertdialog", { name: "删除任务" })
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("saves the title on blur only when it changed", async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn().mockResolvedValue(undefined)
    mocks.updateClientProjectTask.mockResolvedValue({
      ...createTask(),
      title: "新的任务标题",
      updatedAt: "2026-07-14T09:00:00Z",
    })
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          embedded
          onOpenChange={vi.fn()}
          onUpdated={onUpdated}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const title = await screen.findByRole("button", { name: "任务标题" })
    await waitFor(() => expect(title).toBeEnabled())
    await user.click(title)
    await user.tab()
    expect(mocks.updateClientProjectTask).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "任务标题" }))
    const input = screen.getByRole("textbox", { name: "编辑任务标题" })
    await user.clear(input)
    await user.type(input, "新的任务标题")
    await user.tab()

    await waitFor(() => {
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1",
        { title: "新的任务标题" }
      )
      expect(onUpdated).toHaveBeenCalledOnce()
    })
    expect(
      await screen.findByRole("button", { name: "新的任务标题" })
    ).toBeInTheDocument()
  })

  it("sends the task card and keeps the task details open", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const moreButton = await screen.findByRole("button", {
      name: "更多任务操作",
    })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "发送到对话" }))

    await user.click(await screen.findByRole("radio", { name: "设计群" }))
    await user.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => {
      expect(mocks.sendConversationCard).toHaveBeenCalledWith(
        "conversation-1",
        {
          entityId: "task-1",
          entityType: "task",
          type: "entity_card",
        }
      )
    })
    expect(
      screen.queryByRole("dialog", { name: "发送到对话" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "任务标题" })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("confirms before deleting the task", async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onDeleted={onDeleted}
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const moreButton = await screen.findByRole("button", {
      name: "更多任务操作",
    })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }))

    const confirmation = screen.getByRole("alertdialog", {
      name: "删除任务",
    })
    expect(confirmation).toHaveTextContent(
      "确定删除“任务标题”吗？此操作无法撤销。"
    )
    expect(mocks.deleteClientProjectTask).not.toHaveBeenCalled()

    await user.click(
      within(confirmation).getByRole("button", { name: "删除任务" })
    )

    await waitFor(() => {
      expect(mocks.deleteClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1"
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onDeleted).toHaveBeenCalledWith("task-1")
    })
    expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
      onDeleted.mock.invocationCallOrder[0]
    )
  })

  it("keeps the confirmation open when deleting fails", async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onOpenChange = vi.fn()
    mocks.deleteClientProjectTask.mockRejectedValue(
      new Error("没有权限删除任务")
    )
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onDeleted={onDeleted}
          onOpenChange={onOpenChange}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const moreButton = await screen.findByRole("button", {
      name: "更多任务操作",
    })
    await waitFor(() => expect(moreButton).toBeEnabled())
    await user.click(moreButton)
    await user.click(screen.getByRole("menuitem", { name: "删除任务" }))
    const confirmation = screen.getByRole("alertdialog", {
      name: "删除任务",
    })
    await user.click(
      within(confirmation).getByRole("button", { name: "删除任务" })
    )

    await waitFor(() =>
      expect(mocks.deleteClientProjectTask).toHaveBeenCalledOnce()
    )
    expect(confirmation).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it("shows a local save button only after the description changes", async () => {
    const user = userEvent.setup()
    mocks.updateClientProjectTask.mockResolvedValue({
      ...createTask(),
      description: "更新后的详细内容",
      updatedAt: "2026-07-14T09:00:00Z",
    })
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          embedded
          onOpenChange={vi.fn()}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const sourceButton = await screen.findByRole("radio", {
      name: "显示 Markdown 原文",
    })
    await waitFor(() => expect(sourceButton).toBeEnabled())
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    await user.click(sourceButton)
    const description = screen.getByRole("textbox", { name: "详细内容" })
    await user.clear(description)
    await user.type(description, "更新后的详细内容")
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1",
        { description: "更新后的详细内容" }
      )
    })
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
  })

  it("configures a recurring reminder in the task form", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onUpdated = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onOpenChange={onOpenChange}
          onUpdated={onUpdated}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const reminderButton = await screen.findByRole("button", {
      name: "提醒时间",
    })
    expect(reminderButton).toHaveTextContent("不提醒")
    await user.click(reminderButton)
    await user.click(screen.getByRole("button", { name: "重复" }))
    expect(mocks.updateClientProjectTask).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "确定" }))

    await waitFor(() => {
      expect(mocks.updateClientProjectTask).toHaveBeenCalledWith(
        "project-1",
        "task-1",
        {
          reminder: expect.objectContaining({
            frequency: "daily",
            mode: "recurring",
            timezone: "Asia/Shanghai",
          }),
        }
      )
      expect(onUpdated).toHaveBeenCalledOnce()
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })

  it("lists task activities and adds a comment", async () => {
    const user = userEvent.setup()
    mocks.listAllClientProjectMembers.mockResolvedValueOnce([
      {
        avatar: "",
        displayName: "Bob",
        email: "bob@example.com",
        id: "user-2",
        name: "Bob",
        nickname: "",
        role: "member",
        sourceGroupIds: [],
        status: "active",
      },
    ])
    mocks.listClientProjectTaskActivities
      .mockResolvedValueOnce({
        activities: [
          {
            actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
            changes: [
              { field: "status", from: "todo", to: "done" },
              { field: "assignee", from: null, to: "user-2" },
            ],
            content: "",
            createdAt: "2026-07-14T09:00:00Z",
            id: "activity-2",
            projectId: "project-1",
            taskId: "task-1",
            type: "updated",
          },
        ],
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        activities: [
          {
            actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
            changes: [],
            content: "",
            createdAt: "2026-07-14T08:00:00Z",
            id: "activity-1",
            projectId: "project-1",
            taskId: "task-1",
            type: "created",
          },
        ],
        nextCursor: null,
      })
    mocks.addClientProjectTaskComment.mockResolvedValue({
      actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
      changes: [],
      content: "已经处理好了",
      createdAt: "2026-07-14T09:00:00Z",
      id: "activity-comment",
      projectId: "project-1",
      taskId: "task-1",
      type: "commented",
    })

    render(
      <MemoryRouter>
        <ProjectTaskDetailsDialog
          onOpenChange={vi.fn()}
          open
          task={createTask()}
        />
      </MemoryRouter>
    )

    const changedStatus = await screen.findByText("状态", {
      selector: "strong",
    })
    expect(changedStatus).toHaveClass("font-semibold", "text-foreground")
    expect(changedStatus.parentElement).toHaveTextContent(
      "修改 状态 为 已完成、负责人 为 Bob"
    )
    expect(screen.getByText("已完成", { selector: "strong" })).toHaveClass(
      "font-semibold",
      "text-foreground"
    )
    expect(await screen.findByText("Bob", { selector: "strong" })).toHaveClass(
      "font-semibold",
      "text-foreground"
    )
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute(
      "href",
      "/contacts/user/user-1"
    )
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute(
      "target",
      "_blank"
    )
    await user.click(screen.getByRole("button", { name: "展开更早动态" }))
    expect(await screen.findByText("创建了任务")).toBeInTheDocument()
    expect(mocks.listClientProjectTaskActivities).toHaveBeenLastCalledWith(
      "project-1",
      "task-1",
      { cursor: "cursor-1" }
    )

    const commentInput = screen.getByRole("textbox", { name: "发表评论" })
    await user.type(commentInput, "已经处理")
    await user.keyboard("{Shift>}{Enter}{/Shift}好了")
    expect(mocks.addClientProjectTaskComment).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")

    await waitFor(() => {
      expect(mocks.addClientProjectTaskComment).toHaveBeenCalledWith(
        "project-1",
        "task-1",
        "已经处理\n好了"
      )
    })
    expect(await screen.findByText("已经处理好了")).toBeInTheDocument()
  })
})

function createTask(): ProjectTask {
  return {
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-07-14T08:00:00Z",
    creator: {
      avatar: "",
      id: "user-1",
      name: "Alice",
      nickname: "",
    },
    description: "**这是任务说明**",
    dueDate: "2026-07-20",
    id: "task-1",
    labels: [],
    priority: 2,
    reminder: null,
    projectId: "project-1",
    startDate: "2026-07-14",
    status: "todo",
    title: "任务标题",
    updatedAt: "2026-07-14T08:00:00Z",
  }
}
