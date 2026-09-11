import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { MarkdownDocumentEditor } from "./markdown-document-editor"

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  focus: vi.fn(),
  sliceString: vi.fn(() => ""),
}))

vi.mock("@uiw/react-codemirror", async () => {
  const React = await import("react")
  function MockCodeMirror({
    basicSetup,
    onCreateEditor,
    value,
  }: {
    basicSetup: { lineNumbers: boolean }
    onCreateEditor: (view: unknown) => void
    value: string
  }) {
    React.useEffect(() => {
      onCreateEditor({
        dispatch: mocks.dispatch,
        focus: mocks.focus,
        state: {
          doc: { sliceString: mocks.sliceString },
          selection: { main: { from: 0, to: 0 } },
        },
      })
    }, [onCreateEditor])
    return (
      <textarea
        aria-label="Markdown 正文"
        data-line-numbers={basicSetup.lineNumbers}
        readOnly
        value={value}
      />
    )
  }

  return { default: MockCodeMirror }
})

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))

vi.mock("y-codemirror.next", () => ({
  redo: vi.fn(),
  redoDepth: () => 0,
  undo: vi.fn(),
  undoDepth: () => 0,
  yCollab: () => [],
  yUndoManagerKeymap: [],
}))

describe("MarkdownDocumentEditor", () => {
  it("renders collaborative Markdown updates and switches view modes", async () => {
    const user = userEvent.setup()
    mocks.dispatch.mockReset()
    mocks.focus.mockReset()
    mocks.sliceString.mockClear()
    const collaborationDocument = new Y.Doc()
    const markdown = collaborationDocument.getText("markdown")
    markdown.insert(0, "# 开发说明")

    render(
      <MarkdownDocumentEditor
        collaborationDocument={collaborationDocument}
        collaborationProvider={{ awareness: {} } as never}
        onTitleChange={vi.fn()}
        title="开发说明"
      />
    )

    expect(screen.getByLabelText("预览文档标题")).toHaveTextContent("开发说明")
    expect(screen.getByLabelText("预览文档标题")).not.toHaveAttribute(
      "contenteditable"
    )
    expect(
      screen.getByRole("heading", { name: "开发说明" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "分屏" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    const lineNumberToggle = screen.getByRole("button", { name: "行号" })
    expect(lineNumberToggle).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Markdown 正文")).toHaveAttribute(
      "data-line-numbers",
      "true"
    )

    await user.click(lineNumberToggle)
    expect(lineNumberToggle).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText("Markdown 正文")).toHaveAttribute(
      "data-line-numbers",
      "false"
    )

    await user.click(screen.getByRole("button", { name: "粗体" }))
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 0, insert: "**粗体文本**", to: 0 },
      selection: { anchor: 2, head: 6 },
    })
    expect(mocks.focus).toHaveBeenCalled()
    mocks.dispatch.mockClear()
    mocks.focus.mockClear()

    await user.click(screen.getByRole("button", { name: "插入表格" }))
    await user.click(screen.getByRole("gridcell", { name: "2 行 3 列" }))
    expect(mocks.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 0,
        insert: "| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |",
        to: 0,
      },
      scrollIntoView: true,
      selection: { anchor: 2, head: 5 },
    })
    expect(mocks.focus).toHaveBeenCalledOnce()

    act(() => markdown.insert(markdown.length, "\n\n协同更新"))
    await waitFor(() =>
      expect(screen.getByText("协同更新")).toBeInTheDocument()
    )

    await user.click(screen.getByRole("button", { name: "预览" }))
    expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })
})
