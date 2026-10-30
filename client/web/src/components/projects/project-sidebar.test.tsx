import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { ProjectSidebar } from "@/components/projects/project-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  data: {
    me: { id: "me", name: "自己", avatar: "" }, personalProject: null, projects: [],
    projectsLoading: true, projectsError: null as Error | null, projectsLoadingMore: false, projectsNextCursor: null,
  },
}))
vi.mock("@/lib/client-data-context", () => ({ useClientData: () => ({ ...mocks.data, refreshProjects: mocks.refresh }) }))

describe("项目后台加载", () => {
  it("个人工作区未到达时显示局部加载，失败时可重试而不崩溃", () => {
    const component = <MemoryRouter><SidebarProvider><ProjectSidebar onCreate={() => {}} /></SidebarProvider></MemoryRouter>
    const view = render(component)
    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目")
    expect(screen.queryByText("没有匹配的项目")).not.toBeInTheDocument()
    mocks.data.projectsLoading = false
    mocks.data.projectsError = new Error("offline")
    view.rerender(<MemoryRouter><SidebarProvider><ProjectSidebar onCreate={() => {}} /></SidebarProvider></MemoryRouter>)
    expect(screen.getByRole("alert")).toHaveTextContent("offline")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
