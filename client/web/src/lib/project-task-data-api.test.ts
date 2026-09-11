import { describe, expect, it, vi } from "vitest"

import {
  addClientProjectTaskComment,
  deleteClientProjectTask,
  getClientProjectTask,
  listClientProjectTaskActivities,
  updateClientProjectTask,
} from "@/lib/project-task-data-api"

describe("project task data API", () => {
  it("deletes a task", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { task_id: "task-1" },
      })
    )

    await expect(
      deleteClientProjectTask("project-1", "task-1", fetcher)
    ).resolves.toBe("task-1")
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/projects/project-1/tasks/task-1",
      { credentials: "include", method: "DELETE" }
    )
  })

  it("lists activities and normalizes their actor", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          activities: [activityResponse("updated")],
          next_cursor: "cursor-1",
        },
      })
    )

    await expect(
      listClientProjectTaskActivities("project-1", "task-1", {}, fetcher)
    ).resolves.toEqual({
      activities: [
        expect.objectContaining({
          actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
          changes: [{ field: "status", from: "todo", to: "done" }],
          type: "updated",
        }),
      ],
      nextCursor: "cursor-1",
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/projects/project-1/tasks/task-1/activities?limit=20",
      { credentials: "include", method: "GET" }
    )
  })

  it("adds a comment", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: activityResponse("commented") })
      )

    await addClientProjectTaskComment(
      "project-1",
      "task-1",
      "处理完成",
      fetcher
    )
    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/client/projects/project-1/tasks/task-1/comments"
    )
    expect(JSON.parse(String(request.body))).toEqual({ content: "处理完成" })
  })

  it("normalizes a weekly reminder", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: taskResponse({
          mode: "recurring",
          frequency: "weekly",
          timezone: "Asia/Singapore",
          time: "09:30",
          weekdays: [1, 3, 5],
          next_trigger_at: "2026-07-17T01:30:00Z",
          last_processed_at: null,
          state: "scheduled",
        }),
      })
    )

    const task = await getClientProjectTask("project-1", "task-1", fetcher)
    expect(task.reminder).toEqual({
      frequency: "weekly",
      lastProcessedAt: null,
      mode: "recurring",
      nextTriggerAt: "2026-07-17T01:30:00Z",
      state: "scheduled",
      time: "09:30",
      timezone: "Asia/Shanghai",
      weekdays: [1, 3, 5],
    })
  })

  it("serializes a monthly reminder update", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: taskResponse({
          mode: "recurring",
          frequency: "monthly",
          timezone: "Asia/Singapore",
          time: "18:20",
          day_of_month: 31,
          next_trigger_at: "2026-07-31T10:20:00Z",
          last_processed_at: null,
          state: "scheduled",
        }),
      })
    )

    await updateClientProjectTask(
      "project-1",
      "task-1",
      {
        reminder: {
          dayOfMonth: 31,
          frequency: "monthly",
          mode: "recurring",
          time: "18:20",
          timezone: "Asia/Singapore",
        },
      },
      fetcher
    )

    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      reminder: {
        day_of_month: 31,
        frequency: "monthly",
        mode: "recurring",
        time: "18:20",
        timezone: "Asia/Shanghai",
      },
    })
  })
})

function activityResponse(type: "updated" | "commented") {
  return {
    actor: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    changes:
      type === "updated" ? [{ field: "status", from: "todo", to: "done" }] : [],
    content: type === "commented" ? "处理完成" : "",
    created_at: "2026-07-15T01:00:00Z",
    id: "activity-1",
    project_id: "project-1",
    task_id: "task-1",
    type,
  }
}

function taskResponse(reminder: Record<string, unknown>) {
  return {
    assignee: null,
    canceled_at: null,
    completed_at: null,
    created_at: "2026-07-15T00:00:00Z",
    creator: { avatar: "", id: "user-1", name: "Alice", nickname: "" },
    description: "",
    due_date: null,
    id: "task-1",
    labels: [],
    priority: 2,
    project_id: "project-1",
    reminder,
    start_date: null,
    status: "todo",
    title: "Task",
    updated_at: "2026-07-15T00:00:00Z",
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
}
