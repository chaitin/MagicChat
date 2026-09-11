import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MessageRenderErrorBoundary } from "@/components/message-render-error-boundary"

describe("MessageRenderErrorBoundary", () => {
  it("contains a message renderer failure and keeps sibling content visible", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <>
        <MessageRenderErrorBoundary
          fallback={<span>暂不支持查看该消息</span>}
          resetKey="message-1"
        >
          <BrokenMessage />
        </MessageRenderErrorBoundary>
        <span>后续正常消息</span>
      </>
    )

    expect(screen.getByText("暂不支持查看该消息")).toBeInTheDocument()
    expect(screen.getByText("后续正常消息")).toBeInTheDocument()
    consoleError.mockRestore()
  })
})

function BrokenMessage(): React.ReactNode {
  throw new Error("render failed")
}
