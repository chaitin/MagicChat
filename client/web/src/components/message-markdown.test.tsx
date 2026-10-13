import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MessageMarkdown } from "@/components/message-markdown"
import { resolveDocumentImageURLs } from "@/lib/document-image-api"

vi.mock("@/lib/document-image-api", () => ({
  resolveDocumentImageURLs: vi.fn(),
}))

describe("MessageMarkdown", () => {
  beforeEach(() => vi.mocked(resolveDocumentImageURLs).mockReset())

  it("resolves Desktop attachment references by file ID instead of persisting signed URLs", async () => {
    vi.mocked(resolveDocumentImageURLs).mockResolvedValue({
      missingFileIds: [],
      urls: [
        {
          fileId: "file-1",
          url: "https://example.com/image?signature=temporary",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      ],
    })
    render(<MessageMarkdown content="![截图](attachment:file-1)" />)
    expect(await screen.findByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/image?signature=temporary"
    )
    expect(resolveDocumentImageURLs).toHaveBeenCalledWith(["file-1"], false)
  })

  it("refreshes the read URL on retry without modifying the Markdown reference", async () => {
    vi.mocked(resolveDocumentImageURLs)
      .mockRejectedValueOnce(new Error("图片已过期"))
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            fileId: "file-1",
            url: "https://example.com/refreshed",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      })
    render(<MessageMarkdown content="![截图](attachment:file-1)" />)
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/refreshed"
    )
    expect(resolveDocumentImageURLs).toHaveBeenLastCalledWith(["file-1"], true)
  })

  it("clears the image error while a retry is pending", async () => {
    let resolveRetry!: (
      result: Awaited<ReturnType<typeof resolveDocumentImageURLs>>
    ) => void
    vi.mocked(resolveDocumentImageURLs)
      .mockRejectedValueOnce(new Error("图片已过期"))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRetry = resolve
        })
      )
    render(<MessageMarkdown content="![截图](attachment:file-1)" />)
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))

    expect(screen.getByText("图片加载中…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull()
    await act(async () => {
      resolveRetry({
        missingFileIds: [],
        urls: [
          {
            fileId: "file-1",
            url: "https://example.com/refreshed",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      })
    })
    expect(screen.getByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/refreshed"
    )
  })

  it("resets retry state when switching to another attachment", async () => {
    vi.mocked(resolveDocumentImageURLs)
      .mockRejectedValueOnce(new Error("图片已过期"))
      .mockRejectedValueOnce(new Error("仍然无法加载"))
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            fileId: "file-2",
            url: "https://example.com/second",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      })
    const { rerender } = render(
      <MessageMarkdown content="![截图](attachment:file-1)" />
    )
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))
    await screen.findByText("截图：仍然无法加载")

    rerender(<MessageMarkdown content="![截图](attachment:file-2)" />)
    expect(screen.getByText("图片加载中…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull()
    expect(await screen.findByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/second"
    )
    expect(resolveDocumentImageURLs).toHaveBeenLastCalledWith(["file-2"], false)
  })

  it("ignores an old attachment response after switching images", async () => {
    let resolveFirst!: (
      result: Awaited<ReturnType<typeof resolveDocumentImageURLs>>
    ) => void
    vi.mocked(resolveDocumentImageURLs)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockResolvedValueOnce({
        missingFileIds: [],
        urls: [
          {
            fileId: "file-2",
            url: "https://example.com/second",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      })
    const { rerender } = render(
      <MessageMarkdown content="![截图](attachment:file-1)" />
    )
    rerender(<MessageMarkdown content="![截图](attachment:file-2)" />)
    expect(await screen.findByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/second"
    )

    await act(async () => {
      resolveFirst({
        missingFileIds: [],
        urls: [
          {
            fileId: "file-1",
            url: "https://example.com/first",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        ],
      })
    })
    expect(screen.getByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "https://example.com/second"
    )
  })

  it("does not allow attachment URLs in links or resolve malformed file references", async () => {
    const { container } = render(
      <MessageMarkdown content="[链接](attachment:file-1)\n\n![非法图片](attachment:../other)\n\n![脚本](javascript:alert)" />
    )
    await waitFor(() => expect(container.querySelector("a")).toBeNull())
    expect(container.querySelector("img")).toBeNull()
    expect(resolveDocumentImageURLs).not.toHaveBeenCalled()
  })

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

  it("renders inline and display LaTeX formulas with KaTeX", () => {
    const { container } = render(
      <MessageMarkdown
        content={"行内公式 $E = mc^2$\n\n$$\n\\frac{a}{b}\n$$"}
      />
    )

    const inlineMath = container.querySelector(
      '[data-slot="markdown-math-inline"]'
    )
    const displayMath = container.querySelector(
      '[data-slot="markdown-math-display"]'
    )
    expect(inlineMath).toHaveClass("max-w-full", "inline-block")
    expect(inlineMath).not.toHaveClass("overflow-x-auto")
    expect(inlineMath?.querySelector(".katex")).not.toBeNull()
    expect(displayMath).toHaveClass(
      "max-w-full",
      "overflow-x-auto",
      "[scrollbar-width:none]"
    )
    expect(displayMath?.querySelector(".katex-display")).not.toBeNull()
  })

  it("falls back to the LaTeX source when a formula is invalid", () => {
    const { container } = render(
      <MessageMarkdown content={"$\\notARealCommand{x}$"} />
    )

    const fallback = container.querySelector("[data-math-error]")
    expect(fallback).toHaveTextContent("\\notARealCommand{x}")
    expect(fallback).toHaveAttribute("title", "LaTeX 公式无法解析")
  })
})
