# Project Initial Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project page open without a selected project and show the same kind of empty detail state used by chat and contacts.

**Architecture:** Keep selection state in `ProjectsPage` as a nullable project ID. Derive a nullable active project from the existing mock project collection, then conditionally render the existing detail panel or a page-local empty-state component.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, shadcn Sidebar

---

### Task 1: Add the project initial empty state

**Files:**
- Modify: `client-web/src/pages/projects-page.tsx:272-361`
- Modify: `client-web/src/pages/projects-page.tsx:449`

- [x] **Step 1: Make project selection nullable**

Initialize `activeProjectId` with `null` and remove the first-project fallback:

```tsx
const [activeProjectId, setActiveProjectId] = React.useState<string | null>(
  null
)
const activeProject = activeProjectId
  ? (allProjects.find((project) => project.id === activeProjectId) ?? null)
  : null
```

- [x] **Step 2: Allow list items to render without an active project**

Use optional access when deriving each item's selected state:

```tsx
active={activeProject?.id === personalWorkspace.id}
```

```tsx
active={activeProject?.id === project.id}
```

- [x] **Step 3: Render the empty state until a project is selected**

Replace the unconditional detail panel with a conditional branch:

```tsx
{activeProject ? (
  <ProjectPanel key={activeProject.id} project={activeProject} />
) : (
  <ProjectEmptyState />
)}
```

Add the page-local empty state before `ProjectPanel`:

```tsx
function ProjectEmptyState() {
  return (
    <SidebarInset className="min-w-0 overflow-hidden">
      <div className="flex flex-1 items-center justify-center self-stretch text-sm text-muted-foreground">
        选择一个项目查看详情
      </div>
    </SidebarInset>
  )
}
```

- [x] **Step 4: Verify the frontend**

Run:

```bash
cd client-web
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all three commands exit with status 0. Then run from the repository root:

```bash
git diff --check
```

Expected: command exits with status 0 and prints no whitespace errors.
