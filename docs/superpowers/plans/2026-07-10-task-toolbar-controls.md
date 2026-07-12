# Task Toolbar Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task toolbar filters, search input, and search button independent, evenly spaced, default-height controls.

**Architecture:** Keep the existing page-local toolbar components. Flatten the search controls into the toolbar's existing `gap-2` group while retaining only the relative wrapper required to position the search icon.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, shadcn Button and Input

---

### Task 1: Align and Separate Task Toolbar Controls

**Files:**
- Modify: `client-web/src/components/projects/project-tasks-tab.tsx:41-75`

- [x] **Step 1: Flatten the search controls and use default button sizes**

Replace `TaskToolbar` and `FilterButton` with:

```tsx
function TaskToolbar() {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <FilterButton label="状态" />
        <FilterButton label="优先级" />
        <FilterButton label="负责人" />
        <div className="relative min-w-52 sm:min-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索任务内容"
            className="pl-8"
            placeholder="搜索任务内容"
            type="search"
          />
        </div>
        <Button type="button">搜索</Button>
      </div>
      <TaskViewSwitcher />
    </div>
  )
}

function FilterButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline">
      {label}
      <ChevronDown data-icon="inline-end" />
    </Button>
  )
}
```

- [ ] **Step 2: Verify the frontend**

Run from `client-web/`:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit with status 0. Then run from the repository root:

```bash
git diff --check
```

Expected: command exits with status 0 and prints no whitespace errors.
