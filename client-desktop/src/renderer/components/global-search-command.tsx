import * as React from "react"
import { Bot, LoaderCircle, Search, SearchX } from "lucide-react"

import { useLocale } from "@/components/locale-provider"

import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GroupAvatar } from "@/components/group-avatar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAvatarInitial } from "@/lib/avatar"
import type {
  ClientConversation,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import { getConversationDefaultDescription } from "@/lib/conversation-search-description"
import { formatActivityTime } from "@/lib/activity-time"
import type { ConversationSearchField, ConversationSearchResult } from "@/lib/conversation-search"
import {
  createClientSearchService,
  type ClientSearchResults,
  type MessageSearchProvider,
} from "@/lib/client-search"
import {
  createLocalSearchService,
  type DirectorySearchItem,
  type LocalSearchScope,
} from "@/lib/local-search"
import { cn } from "@/lib/utils"

const scopes = [
  { available: true, label: "search.scope.all", value: "all" },
  { available: true, label: "search.scope.directory", value: "directory" },
  { available: true, label: "search.scope.conversation", value: "conversation" },
  { available: true, label: "search.scope.messages", value: "messages" },
  { available: false, label: "search.scope.documents", value: "documents" },
  { available: false, label: "search.scope.tasks", value: "tasks" },
] as const
type Scope = (typeof scopes)[number]["value"]

type SearchOption =
  | { item: DirectorySearchItem; key: string; type: "directory" }
  | { result: ConversationSearchResult; key: string; type: "conversation" }
  | { result: ClientMessageSearchResult; key: string; type: "message" }

export function GlobalSearchCommand({
  contactApps,
  contactGroups,
  contacts,
  conversations,
  currentUserId,
  getConversationDescription,
  messageSearch,
  onSelectDirectoryItem,
  onSelectMessageResult,
  onSelectConversation,
  searchDebounceMs = 500,
  expanded = false,
}: {
  contactApps: ContactApp[]
  contactGroups: ContactGroup[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  getConversationDescription?: (conversation: ClientConversation) => string
  messageSearch?: MessageSearchProvider
  onSelectDirectoryItem: (item: DirectorySearchItem) => void
  onSelectMessageResult?: (result: ClientMessageSearchResult) => void
  onSelectConversation: (conversationId: string) => void
  searchDebounceMs?: number
  expanded?: boolean
}) {
  const { t } = useLocale()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  const [scope, setScope] = React.useState<Scope>("all")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const defaultConversationDescription = React.useCallback(
    (conversation: ClientConversation) => getConversationDefaultDescription(conversation, t),
    [t],
  )
  const conversationDescription = getConversationDescription ?? defaultConversationDescription
  const service = React.useMemo(
    () =>
      createClientSearchService({
        apps: contactApps,
        contacts,
        conversations,
        currentUserId,
        groups: contactGroups,
        messageSearch,
      }),
    [contactApps, contactGroups, contacts, conversations, currentUserId, messageSearch],
  )
  const localService = React.useMemo(
    () =>
      createLocalSearchService({
        apps: contactApps,
        contacts,
        conversations,
        currentUserId,
        groups: contactGroups,
      }),
    [contactApps, contactGroups, contacts, conversations, currentUserId],
  )
  const [searchState, setSearchState] = React.useState<{
    error: string
    key: string
    results: ClientSearchResults
    searching: boolean
  }>({ error: "", key: "", results: emptySearchResults, searching: false })
  const hasKeyword = keyword.trim().length > 0
  const scopeDefinition = scopes.find((candidate) => candidate.value === scope)!
  const searchKey = `${scope}:${keyword.trim()}`
  const messageKeywordTooShort = scope === "messages" && Array.from(keyword.trim()).length < 2
  const canSearch = open && hasKeyword && scopeDefinition.available && !messageKeywordTooShort
  const localResults = React.useMemo(
    () =>
      localService.search({
        keyword,
        scope: getLocalSearchScope(scope),
      }),
    [keyword, localService, scope],
  )
  React.useEffect(() => {
    if (!canSearch) return
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(
      () => {
        setSearchState({ error: "", key: searchKey, results: emptySearchResults, searching: true })
        void service
          .search({ keyword, scope: getClientSearchScope(scope) }, { signal: controller.signal })
          .then((results) => {
            if (active) setSearchState({ error: "", key: searchKey, results, searching: false })
          })
          .catch((error: unknown) => {
            if (active && !isAbortError(error)) {
              setSearchState({
                error: error instanceof Error ? error.message : t("search.error"),
                key: searchKey,
                results: emptySearchResults,
                searching: false,
              })
            }
          })
      },
      Math.max(0, searchDebounceMs),
    )
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [canSearch, keyword, scope, searchDebounceMs, searchKey, service, t])
  const currentSearch = searchState.key === searchKey && canSearch
  const results = {
    conversations: scope === "messages" ? [] : localResults.conversations,
    directory: scope === "messages" ? [] : localResults.directory,
    messages: currentSearch ? searchState.results.messages : [],
  }
  const searching = canSearch && (!currentSearch || searchState.searching)
  const searchError = currentSearch ? searchState.error : ""
  const options = React.useMemo<SearchOption[]>(
    () =>
      scopeDefinition.available
        ? [
            ...results.directory.map((item) => ({
              item,
              key: `directory:${item.type}:${item.id}`,
              type: "directory" as const,
            })),
            ...results.conversations.map((result) => ({
              result,
              key: `conversation:${result.conversation.id}`,
              type: "conversation" as const,
            })),
            ...results.messages.map((result) => ({
              key: `message:${result.message.id}`,
              result,
              type: "message" as const,
            })),
          ]
        : [],
    [results.conversations, results.directory, results.messages, scopeDefinition.available],
  )
  const normalizedActiveIndex =
    options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1)
  const activeOption = normalizedActiveIndex >= 0 ? options[normalizedActiveIndex] : undefined

  React.useEffect(() => {
    if (!activeOption) return
    optionRefs.current.get(activeOption.key)?.scrollIntoView?.({ block: "nearest" })
  }, [activeOption])

  React.useEffect(() => {
    const shortcuts = window.desktop?.shortcuts
    if (!shortcuts?.subscribeSearchOpen) return
    return shortcuts.subscribeSearchOpen(() => {
      setOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [])

  function close() {
    setOpen(false)
    setKeyword("")
    setActiveIndex(0)
  }

  function selectOption(option: SearchOption) {
    if (option.type === "directory") {
      onSelectDirectoryItem(option.item)
    } else if (option.type === "conversation") {
      onSelectConversation(option.result.conversation.id)
    } else if (onSelectMessageResult) {
      onSelectMessageResult(option.result)
    } else {
      onSelectConversation(option.result.conversation.id)
    }
    close()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((current) => (Math.min(current, options.length - 1) + 1) % options.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) => {
        const normalized = Math.min(current, options.length - 1)
        return (normalized - 1 + options.length) % options.length
      })
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (event.key === "Enter" && activeOption) {
      event.preventDefault()
      selectOption(activeOption)
    }
  }

  function handleScopeChange(value: string) {
    setScope(value as Scope)
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const activeDescendant = activeOption
    ? `global-search-option-${normalizedActiveIndex}`
    : undefined

  return (
    <>
      <Button
        aria-label={t(expanded ? "search.workspacePlaceholder" : "search.button")}
        className={expanded ? "workspace-search-trigger" : undefined}
        onClick={() => setOpen(true)}
        size={expanded ? "default" : "icon-sm"}
        title={t(expanded ? "search.workspacePlaceholder" : "search.button")}
        type="button"
        variant="ghost"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        {expanded && <span>{t("search.workspacePlaceholder")}</span>}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">{t("search.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("search.description")}</DialogDescription>
          <div className="flex h-11 items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              aria-activedescendant={activeDescendant}
              aria-autocomplete="list"
              aria-controls="global-search-results"
              aria-expanded={open}
              aria-label={t("search.input")}
              autoComplete="off"
              autoFocus
              className="h-full w-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none outline-none focus-visible:ring-0"
              onChange={(event) => {
                setKeyword(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={t("search.placeholder")}
              role="combobox"
              value={keyword}
            />
          </div>
          <Tabs className="gap-0" onValueChange={handleScopeChange} value={scope}>
            <div className="w-full overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList aria-label={t("search.content")} className="justify-start" variant="line">
                {scopes.map((item) => (
                  <TabsTrigger key={item.value} value={item.value}>
                    {t(item.label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
          <div
            aria-label={t("search.results")}
            className="max-h-96 min-h-48 overflow-y-auto p-2"
            id="global-search-results"
            role="listbox"
          >
            {!hasKeyword ? (
              <GlobalSearchEmptyState state="idle" />
            ) : messageKeywordTooShort ? (
              <GlobalSearchEmptyState description={t("search.minLength")} />
            ) : searching && options.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t("search.searching")}
              </div>
            ) : searchError && options.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <span>{searchError}</span>
                <Button onClick={() => setKeyword((value) => `${value} `)} size="sm" type="button">
                  {t("search.retry")}
                </Button>
              </div>
            ) : !scopeDefinition.available ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("search.pending")}
              </div>
            ) : options.length === 0 ? (
              <GlobalSearchEmptyState state="no-results" />
            ) : (
              <>
                {results.directory.length > 0 && (
                  <SearchGroupLabel id="global-search-directory-label">
                    {t("search.group.directory")}
                  </SearchGroupLabel>
                )}
                {results.directory.map((item, index) => {
                  const option = options[index]
                  return (
                    <SearchRow
                      active={index === normalizedActiveIndex}
                      avatar={<DirectorySearchResultAvatar item={item} />}
                      description={getDirectoryDescription(item, t)}
                      id={`global-search-option-${index}`}
                      key={option.key}
                      label={getDirectoryName(item)}
                      onClick={() => selectOption(option)}
                      onPointerMove={() => setActiveIndex(index)}
                      optionRef={(node) => setOptionRef(optionRefs.current, option.key, node)}
                    />
                  )
                })}
                {results.conversations.length > 0 && (
                  <SearchGroupLabel id="global-search-conversation-label">
                    {t("search.group.conversation")}
                  </SearchGroupLabel>
                )}
                {results.conversations.map((result, resultIndex) => {
                  const index = results.directory.length + resultIndex
                  const option = options[index]
                  return (
                    <SearchRow
                      active={index === normalizedActiveIndex}
                      avatar={
                        <ConversationAvatar
                          className="size-8"
                          conversation={result.conversation}
                          sourceAvatarClassName="size-4"
                        />
                      }
                      description={getConversationResultDescription(
                        result,
                        keyword,
                        conversationDescription,
                        t,
                      )}
                      id={`global-search-option-${index}`}
                      key={option.key}
                      label={getConversationDisplayName(result.conversation)}
                      onClick={() => selectOption(option)}
                      onPointerMove={() => setActiveIndex(index)}
                      optionRef={(node) => setOptionRef(optionRefs.current, option.key, node)}
                    />
                  )
                })}
                {results.messages.length > 0 && (
                  <SearchGroupLabel id="global-search-message-label">
                    {t("search.group.messages")}
                  </SearchGroupLabel>
                )}
                {results.messages.map((result, resultIndex) => {
                  const index =
                    results.directory.length + results.conversations.length + resultIndex
                  const option = options[index]
                  return (
                    <SearchRow
                      active={index === normalizedActiveIndex}
                      avatar={<MessageSearchResultAvatar result={result} />}
                      description={`${result.senderName}：${result.summary}`}
                      id={`global-search-option-${index}`}
                      key={option.key}
                      label={`${result.conversation.name} · ${formatActivityTime(result.message.createdAt)}`}
                      onClick={() => selectOption(option)}
                      onPointerMove={() => setActiveIndex(index)}
                      optionRef={(node) => setOptionRef(optionRefs.current, option.key, node)}
                    />
                  )
                })}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function getClientSearchScope(scope: Scope) {
  if (scope === "directory" || scope === "conversation" || scope === "messages") return scope
  return "all" as const
}

function getLocalSearchScope(scope: Scope): LocalSearchScope {
  if (scope === "directory" || scope === "conversation") return scope
  return "all"
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

const emptySearchResults: ClientSearchResults = {
  conversations: [],
  directory: [],
  messages: [],
}

function SearchGroupLabel({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <p className="px-2 py-1 text-xs text-muted-foreground" id={id}>
      {children}
    </p>
  )
}

function GlobalSearchEmptyState({
  description,
  state,
}: {
  description?: string
  state?: "idle" | "no-results"
}) {
  const { t } = useLocale()
  const idle = state === "idle"
  return (
    <Empty className="min-h-48 rounded-none p-8">
      <EmptyMedia variant="icon">{idle ? <Search /> : <SearchX />}</EmptyMedia>
      <EmptyHeader>
        <EmptyDescription>
          {description ?? (idle ? t("search.idle") : t("search.noResults"))}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SearchRow({
  active,
  avatar,
  description,
  id,
  label,
  onClick,
  onPointerMove,
  optionRef,
}: {
  active: boolean
  avatar: React.ReactNode
  description: string
  id: string
  label: string
  onClick: () => void
  onPointerMove: () => void
  optionRef: (node: HTMLButtonElement | null) => void
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left outline-none hover:bg-accent",
        active && "bg-accent text-accent-foreground",
      )}
      id={id}
      onClick={onClick}
      onPointerMove={onPointerMove}
      ref={optionRef}
      role="option"
      tabIndex={-1}
      type="button"
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function DirectorySearchResultAvatar({ item }: { item: DirectorySearchItem }) {
  if (item.type === "group") {
    return (
      <GroupAvatar
        avatar={item.avatar}
        className="size-8"
        members={item.avatarMembers}
        name={item.name}
      />
    )
  }

  const name = getDirectoryName(item)
  return (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {item.avatar && <AvatarImage alt={name} className="rounded-sm" src={item.avatar} />}
      <AvatarFallback aria-label={name} className="rounded-sm">
        {item.type === "app" ? <Bot className="size-4" /> : getAvatarInitial(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function MessageSearchResultAvatar({ result }: { result: ClientMessageSearchResult }) {
  const { t } = useLocale()
  const name = result.conversation.name || t("search.conversationFallback")
  return (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {result.conversation.avatar && (
        <AvatarImage alt={name} className="rounded-sm" src={result.conversation.avatar} />
      )}
      <AvatarFallback className="rounded-sm">
        {result.conversation.type === "app" ? <Bot className="size-4" /> : getAvatarInitial(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function getDirectoryName(item: DirectorySearchItem) {
  return item.type === "user" ? item.nickname.trim() || item.name.trim() : item.name.trim()
}

function getDirectoryDescription(item: DirectorySearchItem, t: ReturnType<typeof useLocale>["t"]) {
  if (item.type === "user") return item.email.trim() || item.phone.trim() || t("search.contact")
  if (item.type === "app") return item.description.trim() || t("search.app")
  return `${t("search.members", { count: item.memberCount })}${item.joined ? ` · ${t("search.joined")}` : ""}`
}

function getConversationResultDescription(
  result: ConversationSearchResult,
  keyword: string,
  getConversationDescription: (conversation: ClientConversation) => string,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (!keyword.trim()) return getConversationDescription(result.conversation)
  const field = result.matchedField
  if (!field || field.kind === "conversation_name") return t("search.match.name")
  const displayName = field.memberDisplayName
  const value = field.rawValue
  return displayName && displayName !== value
    ? `${getConversationMatchLabel(field, t)}：${displayName} · ${value}`
    : `${getConversationMatchLabel(field, t)}：${value}`
}

function getConversationMatchLabel(
  field: ConversationSearchField,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (field.kind === "member_email") return t("search.match.email")
  if (field.kind === "member_phone") return t("search.match.phone")
  if (field.kind === "app_name") return t("search.match.app")
  return t("search.match.member")
}

function setOptionRef(
  refs: Map<string, HTMLButtonElement>,
  key: string,
  node: HTMLButtonElement | null,
) {
  if (node) refs.set(key, node)
  else refs.delete(key)
}
