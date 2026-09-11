import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationStatusIndicator } from "@/components/conversation/conversation-status-indicator"

describe("ConversationStatusIndicator", () => {
  it("renders the status with three animated dots", () => {
    const { container } = render(
      <ConversationStatusIndicator status="正在思考" />
    )

    expect(screen.getByText("正在思考")).toBeInTheDocument()
    const dots = container.querySelectorAll("[data-status-dot]")
    expect(dots).toHaveLength(3)
    for (const dot of dots) {
      expect(dot).toHaveClass("animate-bounce")
    }
  })
})
