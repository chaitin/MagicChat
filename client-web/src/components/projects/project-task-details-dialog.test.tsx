import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import type { ProjectTask } from "@/components/projects/project-types"

const mocks = vi.hoisted(() => ({
  deleteClientProjectTask: vi.fn(),
  getClientProjectTask: vi.fn(),
  listAllClientProjectMembers: vi.fn(),
  listClientProjectTasks: vi.fn(),
  sendConversationCard: vi.fn(),
  updateClientProjectTask: vi.fn(),
}))

vi.mock("@/lib/project-task-data-api", () => ({
  deleteClientProjectTask: mocks.deleteClientProjectTask,
  getClientProjectTask: mocks.getClientProjectTask,
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
    mocks.deleteClientProjectTask.mockReset()
    mocks.deleteClientProjectTask.mockResolvedValue(task.id)
    mocks.getClientProjectTask.mockReset()
    mocks.getClientProjectTask.mockResolvedValue(task)
    mocks.listAllClientProjectMembers.mockReset()
    mocks.listAllClientProjectMembers.mockResolvedValue([])
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

    const sendButton = await screen.findByRole("button", {
      name: "发送到对话",
    })
    await user.click(sendButton)

    await user.click(screen.getByRole("radio", { name: "设计群" }))
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
    expect(screen.getByRole("dialog", { name: "任务详情" })).toBeInTheDocument()
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

    const deleteButton = await screen.findByRole("button", {
      name: "删除任务",
    })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    await user.click(deleteButton)

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

    const deleteButton = await screen.findByRole("button", {
      name: "删除任务",
    })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    await user.click(deleteButton)
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
    await user.click(screen.getByRole("button", { name: "保存" }))

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
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onUpdated).toHaveBeenCalledOnce()
      expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
        onUpdated.mock.invocationCallOrder[0]
      )
    })
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
