import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageLink } from "./message-link"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe("MessageLink", () => {
  it("renders Desktop icon with title/URL to its right and safely opens a new tab", () => {
    const { container } = render(<MessageLink link={{ title: "示例网站", type: "link", url: "https://example.com/articles/1" }} />)
    const link = screen.getByRole("link")
    expect(link).toHaveClass("flex", "w-full", "items-center", "gap-3")
    expect(link.parentElement).toHaveClass("relative", "w-80", "max-w-full")
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

  it("copies the full URL without opening the link", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    const url = "https://example.com/articles/1?query=value#section"
    render(<MessageLink link={{ title: "示例网站", type: "link", url }} />)
    const link = screen.getByRole("link")
    const openLink = vi.fn((event: Event) => event.preventDefault())
    link.addEventListener("click", openLink)
    const copy = screen.getByRole("button", { name: "复制链接" })
    expect(link).not.toContainElement(copy)
    expect(copy).toHaveClass("absolute", "right-0", "top-0.5")
    expect(screen.getByText("示例网站")).toHaveClass("pr-7")

    await user.click(copy)

    expect(writeText).toHaveBeenCalledWith(url)
    expect(openLink).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("链接已复制"))
  })

  it("supports keyboard copying", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    render(<MessageLink link={{ title: "示例网站", type: "link", url: "https://example.com" }} />)
    const copy = screen.getByRole("button", { name: "复制链接" })
    copy.focus()
    await user.keyboard("{Enter}")
    expect(writeText).toHaveBeenCalledWith("https://example.com")
  })

  it("reports clipboard failures", async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"))
    render(<MessageLink link={{ title: "示例网站", type: "link", url: "https://example.com" }} />)
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("复制链接失败"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(["javascript:alert(1)", "data:text/html,<p>untrusted</p>", "file:///tmp/test", "invalid"])("does not make %s clickable", (url) => {
    render(<MessageLink link={{ title: "链接", type: "link", url }} />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText(url)).toBeInTheDocument()
  })
})
