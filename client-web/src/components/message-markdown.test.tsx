import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageMarkdown } from "@/components/message-markdown"

describe("MessageMarkdown", () => {
  it("preserves rendered DOM nodes when only the mention resolver changes", () => {
    const { rerender } = render(
      <MessageMarkdown
        content="一段可选择的消息"
        currentUserId="user-1"
        mentionLabelResolver={() => "旧名称"}
      />
    )
    const paragraph = screen.getByText("一段可选择的消息")

    rerender(
      <MessageMarkdown
        content="一段可选择的消息"
        currentUserId="user-1"
        mentionLabelResolver={() => "新名称"}
      />
    )

    expect(screen.getByText("一段可选择的消息")).toBe(paragraph)
  })
})
