import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { CollapsibleMessageContent } from "./collapsible-message-content"

describe("CollapsibleMessageContent", () => {
  it("collapses overflowing content and supports expanding it", async () => {
    const user = userEvent.setup()

    await withMockedScrollHeight(500, async () => {
      render(
        <CollapsibleMessageContent variant="markdown">
          <p>很长的 Markdown 内容</p>
        </CollapsibleMessageContent>
      )

      const viewport = screen
        .getByText("很长的 Markdown 内容")
        .closest<HTMLElement>("[id]")
      const expandButton = screen.getByRole("button", { name: "展开全文" })

      expect(viewport).toHaveStyle({ maxHeight: "360px" })
      expect(expandButton).toHaveAttribute("aria-expanded", "false")
      expect(expandButton).toHaveClass("absolute", "h-[calc(3rem+1.75rem)]")
      expect(expandButton.parentElement).toHaveClass("pb-7")

      await user.click(expandButton)
      expect(viewport).not.toHaveStyle({ maxHeight: "360px" })
      expect(
        screen.queryByRole("button", { name: "展开全文" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "收起" })
      ).not.toBeInTheDocument()
    })
  })

  it("does not show a toggle when content fits or collapsing is disabled", async () => {
    await withMockedScrollHeight(100, async () => {
      const { rerender } = render(
        <CollapsibleMessageContent variant="text">
          <span>短消息</span>
        </CollapsibleMessageContent>
      )

      expect(
        screen.queryByRole("button", { name: "展开全文" })
      ).not.toBeInTheDocument()

      rerender(
        <CollapsibleMessageContent enabled={false} variant="text">
          <span>不折叠的消息</span>
        </CollapsibleMessageContent>
      )
      expect(
        screen.getByText("不折叠的消息").parentElement
      ).not.toHaveAttribute("data-slot", "collapsible-message")
    })
  })
})

async function withMockedScrollHeight(
  height: number,
  test: () => Promise<void>
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  )
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => height,
  })

  try {
    await test()
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor)
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  }
}
