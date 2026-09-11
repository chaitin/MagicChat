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
