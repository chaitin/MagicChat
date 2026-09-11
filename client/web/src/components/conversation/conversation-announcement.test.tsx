import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ConversationAnnouncement } from "./conversation-announcement"

describe("ConversationAnnouncement", () => {
  it("renders pure text and ignores an empty announcement", () => {
    const { rerender } = render(
      <ConversationAnnouncement
        announcement={"第一行\n<strong>纯文本</strong>"}
      />
    )

    expect(screen.getByRole("region", { name: "群公告" })).toHaveTextContent(
      "第一行 <strong>纯文本</strong>"
    )
    const announcementText = screen.getByText(/第一行/)
    expect(announcementText).toHaveClass("w-fit", "max-w-full", "text-left")
    expect(announcementText.parentElement).toHaveClass("flex", "justify-center")
    expect(screen.queryByText("纯文本", { selector: "strong" })).toBeNull()

    rerender(<ConversationAnnouncement announcement="   " />)
    expect(screen.queryByRole("region", { name: "群公告" })).toBeNull()
  })

  it("collapses overflowing content to three lines and can expand it", async () => {
    const user = userEvent.setup()
    const scrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    )
    const clientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight"
    )
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 80,
    })
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 60,
    })

    try {
      const { rerender } = render(
        <ConversationAnnouncement announcement={"很长的群公告"} />
      )
      const text = screen.getByText("很长的群公告")
      expect(text).toHaveClass("line-clamp-3")
      await user.click(screen.getByRole("button", { name: "展开" }))
      expect(text).not.toHaveClass("line-clamp-3")
      expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument()

      rerender(<ConversationAnnouncement announcement="另一条群公告" />)
      rerender(<ConversationAnnouncement announcement="很长的群公告" />)
      expect(screen.getByText("很长的群公告")).toHaveClass("line-clamp-3")
      expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument()
    } finally {
      if (scrollHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          scrollHeight
        )
      }
      if (clientHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientHeight
        )
      }
    }
  })
})
