import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useNavigate } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentPage } from "./document-page"

const deleteClientDocument = vi.fn()
const getClientDocument = vi.fn()
const getCurrentClientUser = vi.fn()
const updateCollaborativeDocumentTitle = vi.fn()
const getClientProject = vi.fn()
const { awarenessPeers, sidebarInstances } = vi.hoisted(() => ({
  awarenessPeers: [] as Record<string, unknown>[],
  sidebarInstances: { count: 0 },
}))

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    private readonly configuration: {
      onAwarenessChange?: (value: { states: unknown[] }) => void
    }

    constructor(configuration: {
      onAwarenessChange?: (value: { states: unknown[] }) => void
    }) {
      this.configuration = configuration
    }

    destroy() {}
    setAwarenessField(key: string, value: unknown) {
      this.configuration.onAwarenessChange?.({
        states: [{ [key]: value }, ...awarenessPeers],
      })
    }
  },
  WebSocketStatus: {
    Connected: "connected",
    Connecting: "connecting",
    Disconnected: "disconnected",
  },
}))

vi.mock("@/lib/client-data-api", () => ({
  getCurrentClientUser: (...args: unknown[]) => getCurrentClientUser(...args),
}))

vi.mock("@/lib/document-data-api", () => ({
  deleteClientDocument: (...args: unknown[]) => deleteClientDocument(...args),
  getClientDocument: (...args: unknown[]) => getClientDocument(...args),
  getClientDocumentPath: (documentId: string, documentType: string) =>
    `/documents/${documentType}/${documentId}`,
  updateCollaborativeDocumentTitle: (...args: unknown[]) =>
    updateCollaborativeDocumentTitle(...args),
}))

vi.mock("@/lib/project-data-api", () => ({
  getClientProject: (...args: unknown[]) => getClientProject(...args),
}))

vi.mock("@/components/conversation/send-card-dialog", () => ({
  StandaloneCardDialog: ({
    card,
    open,
  }: {
    card: { description: string; title: string; url: string }
    open: boolean
  }) =>
    open ? (
      <div
        aria-label="发送到对话"
        data-card-title={card.title}
        data-url={card.url}
        role="dialog"
      >
        {card.title}
        {card.description}
      </div>
    ) : null,
}))

vi.mock("@/components/documents/document-workspace-sidebar", async () => {
  const React = await import("react")
  return {
    DocumentWorkspaceSidebar: () => {
      const [instance] = React.useState(() => ++sidebarInstances.count)
      return <aside data-instance={instance}>文档侧栏</aside>
    },
  }
})

vi.mock("@/components/documents/document-editor", () => ({
  DocumentEditor: () => <div>正文编辑器</div>,
}))

vi.mock("@/components/documents/markdown-document-editor", () => ({
  MarkdownDocumentEditor: () => <div>Markdown 编辑器</div>,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const currentUser = {
  avatar: "",
  createdAt: "2026-08-05T09:00:00Z",
  email: "lin@example.com",
  id: "user-1",
  lastOnlineAt: null,
  name: "林晓",
  nickname: "",
  phone: "",
  status: "active",
}

const document = {
  createdAt: "2026-08-05T09:00:00Z",
  creator: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
  documentType: "document",
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "document",
  parentId: null,
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  schemaVersion: 1,
  sortOrder: 0,
  title: "产品需求文档",
  updatedAt: "2026-08-05T09:00:00Z",
  updatedBy: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
}

beforeEach(() => {
  awarenessPeers.length = 0
  sidebarInstances.count = 0
  deleteClientDocument.mockReset().mockResolvedValue({
    deletedCount: 1,
    documentId: document.id,
  })
  getClientDocument.mockReset().mockResolvedValue(document)
  getCurrentClientUser.mockReset().mockResolvedValue(currentUser)
  getClientProject.mockReset().mockResolvedValue({ name: "产品项目" })
  updateCollaborativeDocumentTitle.mockReset().mockResolvedValue("新版需求")
})

describe("DocumentPage", () => {
  it("loads a real document and saves title changes", async () => {
    renderDocumentPage()

    const title = await screen.findByLabelText("顶部文档标题")
    expect(title).toHaveValue("产品需求文档")
    expect(getClientDocument).toHaveBeenCalledWith(document.id)
    expect(getClientProject).toHaveBeenCalledWith(document.projectId)
    expect(getCurrentClientUser).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText("1 人正在查看文档")).toBeInTheDocument()

    fireEvent.change(title, { target: { value: "新版需求" } })
    fireEvent.blur(title)

    await waitFor(() =>
      expect(updateCollaborativeDocumentTitle).toHaveBeenCalledWith(
        document.id,
        "新版需求"
      )
    )
  })

  it("loads Markdown documents in the shared document session", async () => {
    getClientDocument.mockResolvedValueOnce({
      ...document,
      documentType: "markdown",
      title: "开发说明",
    })

    render(
      <MemoryRouter initialEntries={[`/documents/markdown/${document.id}`]}>
        <Routes>
          <Route
            path="/documents/:documentType/:documentId"
            element={<DocumentPage />}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText("Markdown 编辑器")).toBeInTheDocument()
    expect(screen.queryByText("正文编辑器")).not.toBeInTheDocument()
  })

  it("shows every online user in the presence popover", async () => {
    awarenessPeers.push(
      ...Array.from({ length: 5 }, (_, index) => ({
        user: {
          avatar: "",
          color: "#0284c7",
          id: `user-${index + 2}`,
          name: `协作者${index + 2}`,
        },
      }))
    )
    renderDocumentPage()

    const trigger = await screen.findByLabelText("6 人正在查看文档")
    expect(screen.getByText("+1")).toBeInTheDocument()
    fireEvent.click(trigger)

    expect(await screen.findByText("正在查看 · 6 人")).toBeInTheDocument()
    expect(screen.getByText("协作者6")).toBeInTheDocument()
  })

  it("shows the API error for an inaccessible document", async () => {
    getClientDocument.mockRejectedValueOnce(new Error("文档不存在"))
    renderDocumentPage()

    expect(
      await screen.findByText("文档不存在", { selector: "p" })
    ).toBeInTheDocument()
  })

  it("opens a dialog to send the document card to a conversation", async () => {
    const user = userEvent.setup()
    renderDocumentPage()

    await user.click(await screen.findByLabelText("更多文档操作"))
    await user.click(
      await screen.findByRole("menuitem", { name: "发送到对话" })
    )

    const dialog = await screen.findByRole("dialog", { name: "发送到对话" })
    expect(dialog).toHaveTextContent("文档 - 产品需求文档")
    expect(dialog).toHaveTextContent("项目: 产品项目")
    expect(dialog).toHaveAttribute(
      "data-url",
      `/documents/document/${document.id}`
    )
  })

  it("bounds long document titles for message cards", async () => {
    const user = userEvent.setup()
    getClientDocument.mockResolvedValueOnce({
      ...document,
      title: "文".repeat(300),
    })
    renderDocumentPage()

    await user.click(await screen.findByLabelText("更多文档操作"))
    await user.click(
      await screen.findByRole("menuitem", { name: "发送到对话" })
    )

    const dialog = await screen.findByRole("dialog", { name: "发送到对话" })
    const cardTitle = dialog.getAttribute("data-card-title") ?? ""
    expect(Array.from(cardTitle)).toHaveLength(256)
    expect(cardTitle).toMatch(/^文档 - .+…$/)
  })

  it("keeps the sidebar mounted while switching documents in one project", async () => {
    const user = userEvent.setup()
    const nextDocument = {
      ...document,
      id: "550e8400-e29b-41d4-a716-446655440099",
      title: "第二篇文档",
    }
    let resolveNextDocument!: (value: typeof nextDocument) => void
    const nextDocumentRequest = new Promise<typeof nextDocument>((resolve) => {
      resolveNextDocument = resolve
    })
    getClientDocument.mockImplementation((documentId: string) =>
      documentId === nextDocument.id
        ? nextDocumentRequest
        : Promise.resolve(document)
    )

    render(
      <MemoryRouter initialEntries={[`/documents/document/${document.id}`]}>
        <SwitchDocumentButton documentId={nextDocument.id} />
        <Routes>
          <Route
            path="/documents/:documentType/:documentId"
            element={<DocumentPage />}
          />
        </Routes>
      </MemoryRouter>
    )

    const sidebar = await screen.findByText("文档侧栏")
    expect(sidebar).toHaveAttribute("data-instance", "1")

    await user.click(screen.getByRole("button", { name: "切换测试文档" }))

    expect(await screen.findByText("正在加载文档")).toBeInTheDocument()
    expect(screen.getByText("文档侧栏")).toHaveAttribute("data-instance", "1")

    await act(async () => resolveNextDocument(nextDocument))

    expect(await screen.findByLabelText("顶部文档标题")).toHaveValue(
      "第二篇文档"
    )
    expect(screen.getByText("文档侧栏")).toHaveAttribute("data-instance", "1")
    expect(sidebarInstances.count).toBe(1)
  })

  it("confirms deletion and returns to the project document list", async () => {
    const user = userEvent.setup()
    renderDocumentPage()

    await user.click(await screen.findByLabelText("更多文档操作"))
    await user.click(await screen.findByRole("menuitem", { name: "删除" }))

    const confirmation = await screen.findByRole("alertdialog", {
      name: "删除文档",
    })
    expect(confirmation).toHaveTextContent(
      "确定删除“产品需求文档”吗？此操作无法撤销。"
    )
    await user.click(within(confirmation).getByRole("button", { name: "删除" }))

    await waitFor(() =>
      expect(deleteClientDocument).toHaveBeenCalledWith(document.id)
    )
    expect(await screen.findByText("项目文档列表")).toBeInTheDocument()
  })
})

function SwitchDocumentButton({ documentId }: { documentId: string }) {
  const navigate = useNavigate()
  return (
    <button
      aria-label="切换测试文档"
      onClick={() => navigate(`/documents/document/${documentId}`)}
      type="button"
    />
  )
}

function renderDocumentPage() {
  return render(
    <MemoryRouter initialEntries={[`/documents/document/${document.id}`]}>
      <Routes>
        <Route
          path="/documents/:documentType/:documentId"
          element={<DocumentPage />}
        />
        <Route
          path="/projects/:projectId/documents"
          element={<div>项目文档列表</div>}
        />
      </Routes>
    </MemoryRouter>
  )
}
