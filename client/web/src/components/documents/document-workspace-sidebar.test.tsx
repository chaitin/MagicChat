import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentWorkspaceSidebar } from "./document-workspace-sidebar"

const mocks = vi.hoisted(() => ({
  createClientDocument: vi.fn(),
  listClientDocuments: vi.fn(),
  loadMoreProjects: vi.fn(),
}))

vi.mock("@/components/projects/project-avatar", () => ({
  ProjectAvatar: ({ project }: { project: { avatar: string; id: string } }) => (
    <span
      data-avatar={project.avatar}
      data-testid={`project-avatar-${project.id}`}
    />
  ),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    loadMoreProjects: mocks.loadMoreProjects,
    me: { avatar: "", id: "user-1", name: "用户", nickname: "" },
    personalProject: null,
    projects: [
      {
        avatar: "/project-two.png",
        id: "project-2",
        isPersonal: false,
        name: "项目二",
      },
    ],
    projectsLoadingMore: false,
    projectsNextCursor: null,
  }),
}))

vi.mock("@/lib/document-data-api", () => ({
  createClientDocument: (...args: unknown[]) =>
    mocks.createClientDocument(...args),
  getClientDocumentPath: (documentId: string, documentType: string) =>
    `/documents/${documentType}/${documentId}`,
  listClientDocuments: (...args: unknown[]) =>
    mocks.listClientDocuments(...args),
}))

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: () => false,
    },
    releasePointerCapture: {
      configurable: true,
      value: () => undefined,
    },
    scrollIntoView: {
      configurable: true,
      value: () => undefined,
    },
    setPointerCapture: {
      configurable: true,
      value: () => undefined,
    },
  })
})

beforeEach(() => {
  mocks.createClientDocument
    .mockReset()
    .mockResolvedValue({ id: "new-document" })
  mocks.listClientDocuments.mockReset().mockImplementation((projectId) =>
    Promise.resolve([
      {
        documentType: "document",
        id: `document-${projectId}`,
        kind: "document",
        parentId: null,
        sortOrder: 0,
        title: projectId === "project-1" ? "项目一文档" : "项目二文档",
      },
    ])
  )
  mocks.loadMoreProjects.mockReset()
})

describe("DocumentWorkspaceSidebar", () => {
  it("switches only the sidebar tree when selecting another project", async () => {
    const user = userEvent.setup()
    const onBeforeNavigate = vi.fn(() => true)

    render(
      <MemoryRouter>
        <DocumentWorkspaceSidebar
          activeDocumentId="document-project-1"
          activeTitle="项目一文档"
          onBeforeNavigate={onBeforeNavigate}
          projectAvatar="/project-one.png"
          projectId="project-1"
          projectIsPersonal={false}
          projectName="项目一"
        />
      </MemoryRouter>
    )

    expect(await screen.findByText("项目一文档")).toBeInTheDocument()
    const projectSelect = screen.getByRole("button", { name: "切换项目" })
    expect(projectSelect).toHaveTextContent("项目一")
    expect(screen.getByTestId("project-avatar-project-1")).toHaveAttribute(
      "data-avatar",
      "/project-one.png"
    )

    await user.click(projectSelect)
    await user.click(screen.getByRole("menuitemradio", { name: "项目二" }))

    await waitFor(() =>
      expect(mocks.listClientDocuments).toHaveBeenLastCalledWith("project-2")
    )
    expect(await screen.findByText("项目二文档")).toBeInTheDocument()
    expect(screen.getByTestId("project-avatar-project-2")).toHaveAttribute(
      "data-avatar",
      "/project-two.png"
    )
    expect(screen.queryByText("项目一文档")).not.toBeInTheDocument()
    expect(onBeforeNavigate).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "新建文档" }))
    await user.click(screen.getByRole("menuitem", { name: "Markdown 文档" }))
    await waitFor(() =>
      expect(mocks.createClientDocument).toHaveBeenCalledWith("project-2", {
        documentType: "markdown",
        kind: "document",
        title: "无标题 Markdown",
      })
    )
  })
})
