import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router"
import { describe, expect, it } from "vitest"

import { ProjectNavigation } from "@/components/projects/project-navigation"
import { ProjectDefaultRedirect } from "@/pages/projects/project-default-redirect"

describe("project routes", () => {
  it("preserves task deep-link query parameters on the default redirect", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1?taskId=task-1"]}>
        <Routes>
          <Route element={<Outlet />} path="/projects/:projectId">
            <Route index element={<ProjectDefaultRedirect />} />
            <Route path="tasks" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(
      await screen.findByText("/projects/project-1/tasks?taskId=task-1")
    ).toBeInTheDocument()
  })

  it("navigates between project sections with stable absolute paths", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/tasks"]}>
        <Routes>
          <Route
            path="/projects/:projectId/:section"
            element={
              <>
                <ProjectNavigation />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole("link", { name: "目标" }))
    expect(
      await screen.findByText("/projects/project-1/goals")
    ).toBeInTheDocument()
  })
})

function LocationProbe() {
  const location = useLocation()
  return <div>{location.pathname + location.search}</div>
}
