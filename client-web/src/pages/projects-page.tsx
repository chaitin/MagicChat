import * as React from "react"
import {
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesGantt,
  ChevronDown,
  Circle,
  CircleCheckBig,
  Columns3,
  Ellipsis,
  Flag,
  ListTodo,
  LockKeyhole,
  Plus,
  Search,
  UserRound,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ProjectMember = {
  initials: string
  name: string
  tone: string
}

type ProjectTask = {
  assignee: ProjectMember
  dueAt: string
  id: string
  priority: "低" | "中" | "高"
  status: "待处理" | "进行中" | "已完成"
  title: string
}

type ProjectListItem = {
  accent: string
  description: string
  documentCount: number
  doneTasks: number
  fileCount: number
  groupCount: number
  id: string
  isPersonal?: boolean
  memberCount: number
  members: ProjectMember[]
  name: string
  tasks: ProjectTask[]
  totalTasks: number
  updatedAt: string
}

const members = {
  chen: {
    initials: "陈",
    name: "陈曦",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  li: {
    initials: "李",
    name: "李然",
    tone: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  },
  lin: {
    initials: "林",
    name: "林悦",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  me: {
    initials: "我",
    name: "我",
    tone: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  },
  wang: {
    initials: "王",
    name: "王宁",
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  zhou: {
    initials: "周",
    name: "周遥",
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
} satisfies Record<string, ProjectMember>

const personalWorkspace: ProjectListItem = {
  accent: "bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900",
  description: "个人任务与资料",
  documentCount: 3,
  doneTasks: 7,
  fileCount: 8,
  groupCount: 0,
  id: "personal",
  isPersonal: true,
  memberCount: 1,
  members: [members.me],
  name: "个人工作区",
  tasks: [
    {
      assignee: members.me,
      dueAt: "今天",
      id: "personal-1",
      priority: "高",
      status: "进行中",
      title: "整理本周工作计划",
    },
    {
      assignee: members.me,
      dueAt: "明天",
      id: "personal-2",
      priority: "中",
      status: "待处理",
      title: "跟进项目评审反馈",
    },
    {
      assignee: members.me,
      dueAt: "7 月 8 日",
      id: "personal-3",
      priority: "低",
      status: "已完成",
      title: "更新个人工作记录",
    },
  ],
  totalTasks: 12,
  updatedAt: "刚刚",
}

const projects: ProjectListItem[] = [
  {
    accent: "bg-sky-600 text-white",
    description: "客户端、服务端与发布计划",
    documentCount: 12,
    doneTasks: 18,
    fileCount: 24,
    groupCount: 2,
    id: "dianbao",
    memberCount: 6,
    members: [members.li, members.wang, members.chen],
    name: "Dianbao 研发",
    tasks: [
      {
        assignee: members.chen,
        dueAt: "今天",
        id: "dianbao-1",
        priority: "高",
        status: "进行中",
        title: "完成项目数据模型设计",
      },
      {
        assignee: members.li,
        dueAt: "明天",
        id: "dianbao-2",
        priority: "中",
        status: "待处理",
        title: "整理项目列表交互细节",
      },
      {
        assignee: members.wang,
        dueAt: "7 月 13 日",
        id: "dianbao-3",
        priority: "中",
        status: "待处理",
        title: "定义项目成员权限规则",
      },
      {
        assignee: members.li,
        dueAt: "7 月 9 日",
        id: "dianbao-4",
        priority: "低",
        status: "已完成",
        title: "梳理群组关联场景",
      },
    ],
    totalTasks: 32,
    updatedAt: "15 分钟前",
  },
  {
    accent: "bg-emerald-600 text-white",
    description: "内容、活动与版本发布安排",
    documentCount: 8,
    doneTasks: 9,
    fileCount: 16,
    groupCount: 1,
    id: "operations",
    memberCount: 4,
    members: [members.zhou, members.lin, members.chen],
    name: "产品运营",
    tasks: [
      {
        assignee: members.zhou,
        dueAt: "今天",
        id: "operations-1",
        priority: "高",
        status: "进行中",
        title: "确认新版本发布内容",
      },
      {
        assignee: members.lin,
        dueAt: "7 月 12 日",
        id: "operations-2",
        priority: "中",
        status: "待处理",
        title: "准备用户访谈提纲",
      },
      {
        assignee: members.chen,
        dueAt: "7 月 8 日",
        id: "operations-3",
        priority: "低",
        status: "已完成",
        title: "汇总上周运营数据",
      },
    ],
    totalTasks: 14,
    updatedAt: "昨天",
  },
  {
    accent: "bg-amber-500 text-white",
    description: "品牌视觉、页面设计与上线交付",
    documentCount: 6,
    doneTasks: 5,
    fileCount: 32,
    groupCount: 1,
    id: "website",
    memberCount: 5,
    members: [members.wang, members.li, members.lin],
    name: "官网改版",
    tasks: [
      {
        assignee: members.wang,
        dueAt: "7 月 14 日",
        id: "website-1",
        priority: "高",
        status: "进行中",
        title: "完成首页视觉稿",
      },
      {
        assignee: members.li,
        dueAt: "7 月 15 日",
        id: "website-2",
        priority: "中",
        status: "待处理",
        title: "补充产品能力页面文案",
      },
      {
        assignee: members.lin,
        dueAt: "7 月 16 日",
        id: "website-3",
        priority: "中",
        status: "待处理",
        title: "检查移动端页面适配",
      },
    ],
    totalTasks: 20,
    updatedAt: "7 月 8 日",
  },
]

const allProjects = [personalWorkspace, ...projects]

export function ProjectsPage() {
  const [activeProjectId, setActiveProjectId] = React.useState(projects[0].id)
  const [keyword, setKeyword] = React.useState("")
  const normalizedKeyword = keyword.trim().toLowerCase()
  const activeProject =
    allProjects.find((project) => project.id === activeProjectId) ?? projects[0]
  const visiblePersonalWorkspace = normalizedKeyword
    ? personalWorkspace.name.toLowerCase().includes(normalizedKeyword)
    : true
  const visibleProjects = normalizedKeyword
    ? projects.filter((project) =>
        [project.name, project.description].some((value) =>
          value.toLowerCase().includes(normalizedKeyword)
        )
      )
    : projects

  return (
    <SidebarProvider
      className="min-h-0 min-w-0 flex-1"
      style={
        {
          "--sidebar-width": "18rem",
        } as React.CSSProperties
      }
    >
      <Sidebar className="border-r bg-background" collapsible="none">
        <SidebarHeader className="gap-0 p-0">
          <div className="flex h-14 items-center justify-between px-4">
            <h1 className="text-base font-medium">项目</h1>
            <Button
              aria-label="新建项目"
              size="icon-sm"
              title="新建项目"
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                aria-label="搜索项目"
                className="pl-8"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索项目"
                type="search"
                value={keyword}
              />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          {visiblePersonalWorkspace && (
            <ProjectListSection title="个人">
              <ProjectListButton
                active={activeProject.id === personalWorkspace.id}
                onSelect={() => setActiveProjectId(personalWorkspace.id)}
                project={personalWorkspace}
              />
            </ProjectListSection>
          )}
          {visibleProjects.length > 0 && (
            <ProjectListSection title="协作项目">
              {visibleProjects.map((project) => (
                <ProjectListButton
                  active={activeProject.id === project.id}
                  key={project.id}
                  onSelect={() => setActiveProjectId(project.id)}
                  project={project}
                />
              ))}
            </ProjectListSection>
          )}
          {!visiblePersonalWorkspace && visibleProjects.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              没有匹配的项目
            </div>
          )}
        </SidebarContent>
      </Sidebar>

      <ProjectPanel key={activeProject.id} project={activeProject} />
    </SidebarProvider>
  )
}

function ProjectListSection({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>{children}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ProjectListButton({
  active,
  onSelect,
  project,
}: {
  active: boolean
  onSelect: () => void
  project: ProjectListItem
}) {
  const progress = Math.round((project.doneTasks / project.totalTasks) * 100)
  const ProjectIcon = project.isPersonal ? UserRound : BriefcaseBusiness

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-pressed={active}
        className="h-16 gap-3 py-2 data-active:bg-foreground/10 data-active:hover:bg-foreground/10"
        isActive={active}
        onClick={onSelect}
        size="lg"
        type="button"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            project.accent
          )}
        >
          <ProjectIcon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="block min-w-0 flex-1 truncate text-sm font-medium">
              {project.name}
            </span>
            {project.isPersonal && (
              <LockKeyhole
                aria-label="固定的个人工作区"
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
            {project.doneTasks}/{project.totalTasks} 项任务 · {progress}% 完成
          </span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function ProjectPanel({ project }: { project: ProjectListItem }) {
  const extraMemberCount = Math.max(
    project.memberCount - project.members.length,
    0
  )
  const ProjectIcon = project.isPersonal ? UserRound : BriefcaseBusiness

  return (
    <SidebarInset className="min-w-0 overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              project.accent
            )}
          >
            <ProjectIcon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{project.name}</h1>
              {project.isPersonal && <Badge variant="secondary">个人</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {project.description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AvatarGroup className="hidden md:flex">
            {project.members.map((member) => (
              <Avatar className="size-6" key={member.name}>
                <AvatarFallback className={member.tone}>
                  {member.initials}
                </AvatarFallback>
              </Avatar>
            ))}
            {extraMemberCount > 0 && (
              <AvatarGroupCount className="size-6 text-[10px]">
                +{extraMemberCount}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
          <Button size="sm" type="button">
            <Plus data-icon="inline-start" />
            新建任务
          </Button>
          <Button
            aria-label="项目设置"
            size="icon-sm"
            title="项目设置"
            type="button"
            variant="ghost"
          >
            <Ellipsis />
          </Button>
        </div>
      </header>

      <ProjectNavigation project={project} />
      <TaskToolbar />

      <ScrollArea className="min-h-0 flex-1 bg-muted/30">
        <div className="p-4 lg:p-6">
          <TaskList tasks={project.tasks} />
        </div>
      </ScrollArea>
    </SidebarInset>
  )
}

function ProjectNavigation({ project }: { project: ProjectListItem }) {
  const items = [
    { label: "概览" },
    { label: "任务", count: project.totalTasks, active: true },
    { label: "群组", count: project.groupCount },
    { label: "成员", count: project.memberCount },
    { label: "文档", count: project.documentCount },
    { label: "文件", count: project.fileCount },
  ]

  return (
    <nav
      aria-label="项目内容"
      className="flex h-11 shrink-0 items-end gap-5 overflow-x-auto border-b px-4"
    >
      {items.map((item) => (
        <button
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "flex h-full shrink-0 items-center gap-1 border-b-2 border-transparent px-0.5 text-sm text-muted-foreground transition-colors",
            item.active && "border-foreground font-medium text-foreground"
          )}
          key={item.label}
          type="button"
        >
          {item.label}
          {typeof item.count === "number" && (
            <span className="text-xs text-muted-foreground">{item.count}</span>
          )}
        </button>
      ))}
    </nav>
  )
}

function TaskToolbar() {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <FilterButton label="状态" />
        <FilterButton label="优先级" />
        <FilterButton label="负责人" />
        <div className="flex min-w-52 sm:min-w-64">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索任务内容"
              className="rounded-r-none pl-8"
              placeholder="搜索任务内容"
              type="search"
            />
          </div>
          <Button className="rounded-l-none" size="sm" type="button">
            搜索
          </Button>
        </div>
      </div>
      <TaskViewSwitcher />
    </div>
  )
}

function FilterButton({ label }: { label: string }) {
  return (
    <Button size="sm" type="button" variant="outline">
      {label}
      <ChevronDown data-icon="inline-end" />
    </Button>
  )
}

function TaskViewSwitcher() {
  const views = [
    { label: "任务列表", icon: ListTodo, active: true },
    { label: "看板", icon: Columns3 },
    { label: "日历", icon: CalendarDays },
    { label: "甘特图", icon: ChartNoAxesGantt },
  ]

  return (
    <div
      aria-label="任务视图"
      className="flex shrink-0 items-center rounded-md border bg-background p-0.5"
      role="group"
    >
      {views.map((view) => {
        const Icon = view.icon

        return (
          <Button
            aria-label={view.label}
            aria-pressed={view.active}
            className={cn(
              "size-7 rounded-sm text-muted-foreground",
              view.active && "bg-muted text-foreground shadow-xs"
            )}
            key={view.label}
            size="icon-xs"
            title={view.label}
            type="button"
            variant="ghost"
          >
            <Icon />
          </Button>
        )
      })}
    </div>
  )
}

function TaskList({ tasks }: { tasks: ProjectTask[] }) {
  return (
    <section className="overflow-hidden rounded-md border bg-background shadow-xs">
      <Table className="min-w-176 table-fixed">
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-muted/40">
            <TableHead className="h-8 w-[46%] px-4 text-xs text-muted-foreground">
              任务
            </TableHead>
            <TableHead className="h-8 w-28 text-xs text-muted-foreground">
              状态
            </TableHead>
            <TableHead className="h-8 w-28 text-xs text-muted-foreground">
              优先级
            </TableHead>
            <TableHead className="h-8 w-32 text-xs text-muted-foreground">
              负责人
            </TableHead>
            <TableHead className="h-8 w-24 pr-4 text-xs text-muted-foreground">
              截止时间
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function TaskRow({ task }: { task: ProjectTask }) {
  const completed = task.status === "已完成"

  return (
    <TableRow className="h-15 hover:bg-muted/35">
      <TableCell className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {completed ? (
            <CircleCheckBig
              aria-hidden="true"
              className="size-4 shrink-0 text-emerald-600"
            />
          ) : (
            <Circle
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                task.status === "进行中" && "fill-sky-500/20 text-sky-600"
              )}
            />
          )}
          <span
            className={cn(
              "truncate text-sm",
              completed && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <TaskStatus status={task.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-xs">
          <Flag
            aria-hidden="true"
            className={cn(
              "size-3.5",
              task.priority === "高"
                ? "text-rose-600"
                : task.priority === "中"
                  ? "text-amber-600"
                  : "text-muted-foreground"
            )}
          />
          {task.priority}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            <AvatarFallback className={task.assignee.tone}>
              {task.assignee.initials}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-xs">{task.assignee.name}</span>
        </div>
      </TableCell>
      <TableCell className="pr-4">
        <time className="text-xs whitespace-nowrap text-muted-foreground">
          {task.dueAt}
        </time>
      </TableCell>
    </TableRow>
  )
}

function TaskStatus({ status }: { status: ProjectTask["status"] }) {
  return (
    <span
      className={cn(
        "text-xs whitespace-nowrap",
        status === "进行中"
          ? "text-sky-700 dark:text-sky-300"
          : status === "已完成"
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground"
      )}
    >
      {status}
    </span>
  )
}
