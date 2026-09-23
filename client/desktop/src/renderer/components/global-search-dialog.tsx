import { useEffect, useRef, useState } from "react"
import { Loading03Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatMentionText, type MentionLabelResolver } from "@/lib/message-mentions"
import type {
  LocalSearchCategory,
  LocalSearchResponse,
  LocalSearchResult,
  LocalSearchSection,
} from "../../shared/account-data"

const SEARCH_CATEGORIES: Array<{ value: LocalSearchCategory; label: string }> = [
  { value: "all", label: "综合" },
  { value: "contacts", label: "联系人" },
  { value: "apps", label: "应用" },
  { value: "groups", label: "群聊" },
  { value: "messages", label: "聊天记录" },
]

const RESULT_SECTIONS = [
  { value: "contacts", label: "联系人" },
  { value: "apps", label: "应用" },
  { value: "groups", label: "群聊" },
  { value: "messages", label: "聊天记录" },
] as const

export function GlobalSearchDialog({
  open,
  targetId,
  theme,
  mentionLabelResolver,
  onOpenChange,
  onSelectResult,
}: {
  open: boolean
  targetId: string
  theme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onOpenChange: (open: boolean) => void
  onSelectResult: (result: LocalSearchResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRevision = useRef(0)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [category, setCategory] = useState<LocalSearchCategory>("all")
  const [results, setResults] = useState<LocalSearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
      setCategory("all")
      setResults(null)
      setSearching(false)
      setError("")
      requestRevision.current += 1
      return
    }
    const normalized = query.trim()
    requestRevision.current += 1
    setDebouncedQuery("")
    setResults(null)
    setSearching(false)
    setError("")
    if (!normalized) return
    const timer = window.setTimeout(() => setDebouncedQuery(normalized), 500)
    return () => window.clearTimeout(timer)
  }, [open, query])

  useEffect(() => {
    if (!open || !debouncedQuery) return
    const revision = ++requestRevision.current
    setResults(null)
    setSearching(true)
    setError("")
    void (async () => {
      const result = window.desktop
        ? await window.desktop.accountData.searchLocal({
            targetId,
            query: debouncedQuery,
            category,
          })
        : { ok: false as const, error: { code: "bridge", message: "桌面服务暂不可用" } }
      if (revision !== requestRevision.current) return
      setSearching(false)
      if (result.ok) setResults(result.data)
      else setError(result.error.message)
    })()
    return () => {
      if (revision === requestRevision.current) requestRevision.current += 1
    }
  }, [category, debouncedQuery, open, targetId])

  function selectCategory(value: string) {
    setCategory(value as LocalSearchCategory)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function selectResult(result: LocalSearchResult) {
    onSelectResult(result)
    onOpenChange(false)
  }

  const visibleSections =
    category === "all"
      ? RESULT_SECTIONS
      : RESULT_SECTIONS.filter((section) => section.value === category)
  let resultCount = 0
  if (results) {
    for (const section of visibleSections) resultCount += results[section.value].items.length
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="搜索"
      description="搜索联系人、应用、群聊和聊天记录"
      className="top-1/2! h-[65vh] max-h-[35rem] -translate-y-1/2! sm:max-w-2xl"
    >
      <Command shouldFilter={false} loop className="rounded-none! p-0">
        <CommandInput
          ref={inputRef}
          value={query}
          autoFocus
          aria-label="搜索本地内容"
          placeholder="搜索"
          wrapperClassName="border-b p-0!"
          inputGroupClassName="h-11! rounded-none! border-0! bg-transparent! px-3 shadow-none!"
          iconClassName="size-4 opacity-60"
          className="pl-3! text-sm leading-4"
          onValueChange={setQuery}
        />
        <Tabs value={category} className="gap-0 border-b" onValueChange={selectCategory}>
          <TabsList
            variant="line"
            className="h-9 w-full justify-start gap-1 rounded-none px-3 py-0"
          >
            {SEARCH_CATEGORIES.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="h-9 flex-none rounded-none border-x-0! border-t-0! border-b-2! border-b-transparent! px-3 after:hidden data-[state=active]:border-b-foreground!"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:block! [&>div]:h-full! [&>div]:w-full!"
        >
          {!query.trim() ? (
            <SearchState icon={Search01Icon} description="输入关键词开始搜索" />
          ) : !debouncedQuery || searching ? (
            <SearchState icon={Loading03Icon} description="正在搜索" loading />
          ) : error ? (
            <SearchState icon={Search01Icon} description={error} />
          ) : results && resultCount > 0 ? (
            <CommandList className="max-h-none overflow-visible">
              {visibleSections.map((definition) => (
                <SearchResultSection
                  key={definition.value}
                  category={category}
                  definition={definition}
                  section={results[definition.value]}
                  targetId={targetId}
                  theme={theme}
                  mentionLabelResolver={mentionLabelResolver}
                  onMore={selectCategory}
                  onSelect={selectResult}
                />
              ))}
            </CommandList>
          ) : (
            <SearchState icon={Search01Icon} description="未找到相关内容" />
          )}
        </ScrollArea>
      </Command>
    </CommandDialog>
  )
}

function SearchResultSection({
  category,
  definition,
  section,
  targetId,
  theme,
  mentionLabelResolver,
  onMore,
  onSelect,
}: {
  category: LocalSearchCategory
  definition: (typeof RESULT_SECTIONS)[number]
  section: LocalSearchSection<LocalSearchResult>
  targetId: string
  theme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onMore: (category: string) => void
  onSelect: (result: LocalSearchResult) => void
}) {
  if (!section.items.length) return null
  return (
    <CommandGroup
      heading={definition.label}
      className="px-2 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col [&_[cmdk-group-items]]:gap-1 [&_[cmdk-group-items]]:rounded-lg [&_[cmdk-group-items]]:bg-xgui-background-1 [&_[cmdk-group-items]]:p-1"
    >
      {section.items.map((result) => (
        <SearchResultItem
          key={`${result.kind}:${result.id}`}
          result={result}
          targetId={targetId}
          theme={theme}
          mentionLabelResolver={mentionLabelResolver}
          onSelect={() => onSelect(result)}
        />
      ))}
      {category === "all" && section.hasMore && (
        <CommandItem
          value={`more:${definition.value}`}
          className="min-h-7 justify-center py-1! text-xgui-link! data-[selected=true]:bg-xgui-background-0! data-[selected=true]:text-xgui-link! [&>svg:last-child]:hidden"
          onSelect={() => onMore(definition.value)}
        >
          <span className="text-xs text-xgui-link!">查看更多</span>
        </CommandItem>
      )}
    </CommandGroup>
  )
}

function SearchResultItem({
  result,
  targetId,
  theme,
  mentionLabelResolver,
  onSelect,
}: {
  result: LocalSearchResult
  targetId: string
  theme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelect: () => void
}) {
  const presentation = resultPresentation(result, mentionLabelResolver)
  const avatarType = result.kind === "message" ? result.conversationAvatarType : result.avatarType
  const avatarId = result.kind === "message" ? result.conversationAvatarId : result.avatarId
  return (
    <CommandItem
      value={`${result.kind}:${result.id}:${presentation.title}`}
      className="data-[selected=true]:bg-xgui-background-0! [&>svg:last-child]:hidden"
      onSelect={onSelect}
    >
      <EntityAvatar
        targetId={targetId}
        type={avatarType}
        id={avatarId}
        theme={theme}
        label={presentation.title}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="min-w-0 flex-1 truncate">{presentation.title}</span>
          {presentation.meta && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {presentation.meta}
            </span>
          )}
        </span>
        {presentation.description && (
          <span className="block truncate text-xs text-muted-foreground">
            {presentation.description}
          </span>
        )}
      </span>
    </CommandItem>
  )
}

function resultPresentation(result: LocalSearchResult, mentionLabelResolver: MentionLabelResolver) {
  if (result.kind === "contact") {
    const title = result.nickname || result.name
    return {
      title,
      description: result.nickname ? result.name || result.email : result.email || result.phone,
      meta: "",
    }
  }
  if (result.kind === "app") {
    return { title: result.name, description: result.description, meta: "" }
  }
  if (result.kind === "group") {
    return { title: result.name, description: `${result.memberCount} 人`, meta: "" }
  }
  return {
    title: result.conversationName || "群聊",
    description: `${result.senderName || "成员"}：${formatMentionText(result.summary, mentionLabelResolver)}`,
    meta: formatSearchTime(result.createdAt),
  }
}

function SearchState({
  icon,
  description,
  loading = false,
}: {
  icon: typeof Search01Icon
  description: string
  loading?: boolean
}) {
  return (
    <Empty className="min-h-full gap-6 p-10">
      <EmptyHeader className="gap-4">
        <EmptyMedia variant="icon" className="size-14 rounded-2xl">
          <HugeiconsIcon
            icon={icon}
            className={`size-8 ${loading ? "animate-spin" : ""}`}
            aria-hidden
          />
        </EmptyMedia>
        <EmptyDescription className="text-base">{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function formatSearchTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date)
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date)
}
