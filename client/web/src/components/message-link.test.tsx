import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageLink } from "./message-link"

describe("MessageLink", () => {
  it("renders Desktop icon with title/URL to its right and safely opens a new tab", () => {
    const { container } = render(<MessageLink link={{ title: "示例网站", type: "link", url: "https://example.com/articles/1" }} />)
    const link = screen.getByRole("link")
    expect(link).toHaveClass("flex", "w-80", "items-center", "gap-3")
    expect(link).toHaveAttribute("href", "https://example.com/articles/1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(container.querySelector("svg")).toHaveClass("size-7", "text-foreground")
    const title = screen.getByText("示例网站")
    const url = screen.getByText("https://example.com/articles/1")
    expect(title.parentElement).toHaveClass("min-w-0", "flex-1")
    expect(url.parentElement).toBe(title.parentElement)
    expect(url).toHaveClass("truncate", "text-xs", "text-muted-foreground")
  })

  it.each(["javascript:alert(1)", "data:text/html,<p>untrusted</p>", "file:///tmp/test", "invalid"])("does not make %s clickable", (url) => {
    render(<MessageLink link={{ title: "链接", type: "link", url }} />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText(url)).toBeInTheDocument()
  })
})
