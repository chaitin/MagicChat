import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageLink } from "./message-link"

describe("MessageLink", () => {
  it("renders the title and URL on separate rows", () => {
    render(
      <MessageLink
        link={{
          title: "示例网站",
          type: "link",
          url: "https://example.com/articles/1",
        }}
      />
    )

    const link = screen.getByRole("link")
    expect(link).toHaveClass("grid", "w-80")
    expect(link).toHaveAttribute("href", "https://example.com/articles/1")
    expect(screen.getByText("示例网站").parentElement).toHaveClass("flex")
    expect(screen.getByText("https://example.com/articles/1")).toHaveClass(
      "truncate"
    )
  })
})
