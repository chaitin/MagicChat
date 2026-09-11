import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { readFileSync } from "node:fs"

const workspaceCss = readFileSync("src/renderer/styles/desktop-workspace.css", "utf8")

function PanelSurfaces() {
  return (
    <main className="workspace-conversation-panel">
      <header className="conversation-panel-header-surface">
        <h2>会话</h2>
      </header>
      <div className="workspace-message-bubble" data-own-message="true">
        消息
      </div>
      <footer className="conversation-panel-composer-surface">
        <div className="workspace-composer-editor">
          <textarea aria-label="消息" />
          <div data-align="block-end">
            <button className="workspace-send-button">发送</button>
          </div>
        </div>
      </footer>
    </main>
  )
}

function selectors(rules: CSSRuleList): string[] {
  return Array.from(rules).flatMap((rule) => {
    if ("selectorText" in rule && typeof rule.selectorText === "string") return [rule.selectorText]
    if ("cssRules" in rule) return selectors(rule.cssRules as CSSRuleList)
    return []
  })
}

it("主聊天样式不会命中通过 Sheet portal 渲染的话题面板", () => {
  const style = document.createElement("style")
  style.textContent = workspaceCss
  document.head.append(style)
  try {
    const { container } = render(
      <div className="workspace-shell workspace-page-layout workspace-chat-layout">
        <PanelSurfaces />
        <Sheet open>
          <SheetContent>
            <SheetTitle>话题</SheetTitle>
            <SheetDescription>话题消息</SheetDescription>
            <PanelSurfaces />
          </SheetContent>
        </Sheet>
      </div>,
    )
    const sheet = style.sheet
    if (!sheet) throw new Error("工作区样式未加载")
    const cssSelectors = selectors(sheet.cssRules)
    const main = container.querySelector("main")
    const drawer = screen.getByRole("dialog", { name: "话题" }).querySelector("main")
    if (!main || !drawer) throw new Error("会话面板未渲染")
    expect(drawer.closest(".workspace-chat-layout")).toBeNull()
    for (const element of [main, ...main.querySelectorAll("*")]) {
      expect(
        cssSelectors.some((selector) => element.matches(selector)),
        element.outerHTML,
      ).toBe(true)
    }
    for (const element of [drawer, ...drawer.querySelectorAll("*")]) {
      expect(cssSelectors.filter((selector) => element.matches(selector))).toEqual([])
    }
  } finally {
    style.remove()
  }
})
