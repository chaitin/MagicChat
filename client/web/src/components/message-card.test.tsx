import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { MessageCard } from "@/components/message-card"
import type { ClientCardMessageBody } from "@/lib/client-data-api"

describe("MessageCard", () => {
  it.each([
    ["contact", "user"],
    ["app", "app"],
    ["group", "group"],
  ])("routes %s namecards to the directory", (kind, route) => {
    const id = "550e8400-e29b-41d4-a716-446655440000"
    renderCard(createCard(`jiying://${kind}/${id}`))
    expect(screen.getByRole("link", { name: /查看详情/ })).toHaveAttribute(
      "href",
      `/contacts/${route}/${id}`
    )
  })

  it.each([
    "jiying://contact/not-a-uuid",
    "jiying://task/550e8400-e29b-41d4-a716-446655440000",
    "jiying://app/550e8400-e29b-41d4-a716-446655440000?server=other",
  ])("rejects unsupported namecard URL %s", (url) => {
    renderCard(createCard(url))
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("renders an internal action as a router link", () => {
    renderCard(createCard("/projects/project-1?taskId=task-1"))

    expect(screen.getByText("任务标题")).toHaveClass("truncate")
    expect(screen.getByText("任务说明")).toHaveClass(
      "line-clamp-3",
      "break-all",
      "whitespace-pre-wrap"
    )
    expect(screen.getByText("任务说明")).not.toHaveClass("truncate")
    expect(
      screen.getByRole("link", { name: "任务标题，查看详情" })
    ).toHaveAttribute("href", "/projects/project-1?taskId=task-1")
  })

  it.each(["http://example.com/tasks/1", "https://example.com/tasks/1"])(
    "opens external URL %s in a new window",
    (url) => {
      renderCard(createCard(url))

      const link = screen.getByRole("link", { name: "任务标题，查看详情" })
      expect(link).toHaveAttribute("href", url)
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
    }
  )

  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "https:example.com/path",
    "//evil.example/path",
    String.raw`/projects\\evil`,
    String.raw`https://example.com/projects\\evil`,
  ])("disables unsafe action %s", (url) => {
    renderCard(createCard(url))

    expect(
      screen.queryByRole("link", { name: /查看详情/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /查看详情/ })
    ).not.toBeInTheDocument()
  })
})

function renderCard(card: ClientCardMessageBody) {
  return render(
    <MemoryRouter>
      <MessageCard card={card} />
    </MemoryRouter>
  )
}

function createCard(url: string): ClientCardMessageBody {
  return {
    description: "任务说明",
    title: "任务标题",
    type: "card",
    url,
  }
}
