import * as React from "react"
import { Bot, LoaderCircle, Search, SearchX } from "lucide-react"

import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GroupAvatar } from "@/components/group-avatar"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAvatarInitial } from "@/lib/avatar"
import { formatActivityTime } from "@/lib/activity-time"
import type {
  ClientConversation,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import {
  createClientSearchService,
  type ClientSearchResults,
  type ClientSearchScope,
  type MessageSearchProvider,
} from "@/lib/client-search"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import {
  type ConversationSearchField,
  type ConversationSearchResult,
  type DirectorySearchItem,
} from "@/lib/local-search"

const globalSearchScopes = [
  { available: true, label: "综合", value: "all" },
  { available: true, label: "通讯录", value: "directory" },
  { available: true, label: "对话", value: "conversation" },
  { available: true, label: "聊天记录", value: "messages" },
  { available: false, label: "文档", value: "documents" },
  { available: false, label: "任务", value: "tasks" },
] as const

type GlobalSearchScope = (typeof globalSearchScopes)[number]["value"]

type SearchExecutionState = {
  error: string
  key: string
  results: ClientSearchResults
  searching: boolean
}

const emptySearchResults: ClientSearchResults = {
  conversations: [],
  directory: [],
  messages: [],
}

export function GlobalSearchCommand({
  contactApps,
  contactGroups,
  contacts,
  conversations,
  currentUserId,
  getConversationDescription,
  messageSearch,
  onOpen,
  onSelectDirectoryItem,
  onSelectConversation,
  onSelectMessageResult,
  searchDebounceMs = 500,
}: {
  contactApps: ContactApp[]
  contactGroups: ContactGroup[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  getConversationDescription: (conversation: ClientConversation) => string
  messageSearch?: MessageSearchProvider
  onOpen?: () => void
  onSelectDirectoryItem: (item: DirectorySearchItem) => void
  onSelectConversation: (conversationId: string) => void
  onSelectMessageResult?: (result: ClientMessageSearchResult) => void
  searchDebounceMs?: number
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [keyword, setKeyword] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [scope, setScope] = React.useState<GlobalSearchScope>("all")
  const [searchState, setSearchState] = React.useState<SearchExecutionState>({
    error: "",
    key: "",
    results: emptySearchResults,
    searching: false,
  })
  const directoryDataKey = React.useMemo(
    () =>
      JSON.stringify({
        apps: contactApps.map((item) => [item.id, item.name]),
        groups: contactGroups.map((item) => [item.id, item.name]),
        users: contacts.map((item) => [
          item.id,
          item.name,
          item.nickname,
          item.email,
        ]),
      }),
    [contactApps, contactGroups, contacts]
  )
  const searchService = React.useMemo(
    () =>
      createClientSearchService({
        apps: contactApps,
        contacts,
        conversations,
        currentUserId,
        groups: contactGroups,
        messageSearch,
      }),
    [
      contactApps,
      contactGroups,
      contacts,
      conversations,
      currentUserId,
      messageSearch,
    ]
  )
  const runSearch = React.useEffectEvent(
    (nextKeyword: string, nextScope: GlobalSearchScope, signal: AbortSignal) =>
      searchService.search(
        {
          keyword: nextKeyword,
          scope: getClientSearchScope(nextScope),
        },
        { signal }
      )
  )
  const scopeDefinition = globalSearchScopes.find(
    (candidate) => candidate.value === scope
  )!
  const hasKeyword = keyword.trim().length > 0
  const showDirectoryResults = scope === "all" || scope === "directory"
  const showConversationResults = scope === "all" || scope === "conversation"
  const showMessageResults = scope === "all" || scope === "messages"
  const messageKeywordTooShort =
    scope === "messages" && Array.from(keyword.trim()).length < 2
  const canSearch =
    open && hasKeyword && scopeDefinition.available && !messageKeywordTooShort
  const searchKey = `${scope}:${keyword.trim()}`
  const searchStateIsCurrent = canSearch && searchState.key === searchKey
  const searchResults = searchStateIsCurrent
    ? searchState.results
    : emptySearchResults
  const searchError = searchStateIsCurrent ? searchState.error : ""
  const searching =
    canSearch && (!searchStateIsCurrent || searchState.searching)
  const directoryResults = searchResults.directory
  const conversationResults = searchResults.conversations
  const messageResults = searchResults.messages
  const hasSearchResults =
    directoryResults.length > 0 ||
    conversationResults.length > 0 ||
    messageResults.length > 0

  React.useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "f" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }

      event.preventDefault()
      onOpen?.()
      setOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }

    window.addEventListener("keydown", handleSearchShortcut)
    return () => window.removeEventListener("keydown", handleSearchShortcut)
  }, [onOpen])

  React.useEffect(() => {
    if (!canSearch) {
      return
    }

    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(
      () => {
        setSearchState({
          error: "",
          key: searchKey,
          results: emptySearchResults,
          searching: true,
        })
        void runSearch(keyword, scope, controller.signal)
          .then((results) => {
            if (active) {
              setSearchState({
                error: "",
                key: searchKey,
                results,
                searching: false,
              })
            }
          })
          .catch((error: unknown) => {
            if (active && !isAbortError(error)) {
              setSearchState({
                error: getClientDataErrorMessage(
                  error,
                  "搜索内容失败，请稍后重试"
                ),
                key: searchKey,
                results: emptySearchResults,
                searching: false,
              })
            }
          })
      },
      Math.max(0, searchDebounceMs)
    )

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [
    canSearch,
    directoryDataKey,
    keyword,
    scope,
    searchDebounceMs,
    searchKey,
  ])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) onOpen?.()
    setOpen(nextOpen)
    if (!nextOpen) {
      setKeyword("")
    }
  }

  function selectConversation(conversationId: string) {
    onSelectConversation(conversationId)
    handleOpenChange(false)
  }

  function selectDirectoryItem(item: DirectorySearchItem) {
    onSelectDirectoryItem(item)
    handleOpenChange(false)
  }

  function selectMessageResult(result: ClientMessageSearchResult) {
    if (onSelectMessageResult) {
      onSelectMessageResult(result)
    } else {
      onSelectConversation(result.conversation.id)
    }
    handleOpenChange(false)
  }

  function handleScopeChange(nextScope: string) {
    setScope(nextScope as GlobalSearchScope)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <>
      <Button
        aria-label="全局搜索"
        onClick={() => handleOpenChange(true)}
        size="icon-sm"
        title="全局搜索"
        type="button"
        variant="ghost"
      >
        <Search className="size-4" />
      </Button>
      <CommandDialog
        className="sm:max-w-xl"
        commandProps={{
          label: "搜索所有内容",
          loop: true,
          shouldFilter: false,
        }}
        description="搜索会话以及其他内容"
        onOpenChange={handleOpenChange}
        open={open}
        title="全局搜索"
      >
        <CommandInput
          ref={inputRef}
          aria-label="搜索所有内容"
          onValueChange={setKeyword}
          placeholder="搜索 (Ctrl+F / Command+F)"
          value={keyword}
        />
        <Tabs className="gap-0" onValueChange={handleScopeChange} value={scope}>
          <div className="w-full [scrollbar-width:none] overflow-x-auto overflow-y-hidden border-b [&::-webkit-scrollbar]:hidden">
            <TabsList
              aria-label="搜索内容"
              className="justify-start"
              variant="line"
            >
              {globalSearchScopes.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <CommandList>
          {!hasKeyword && <GlobalSearchEmptyState state="idle" />}
          {hasKeyword && messageKeywordTooShort && (
            <GlobalSearchEmptyState description="至少输入 2 个字符" />
          )}
          {hasKeyword && searching && !hasSearchResults && (
            <GlobalSearchLoadingState />
          )}
          {hasKeyword && !searching && searchError && (
            <GlobalSearchEmptyState description={searchError} />
          )}
          {hasKeyword &&
            !messageKeywordTooShort &&
            !searching &&
            !searchError &&
            scopeDefinition.available &&
            !hasSearchResults && <GlobalSearchEmptyState state="no-results" />}
          {hasKeyword && !scopeDefinition.available && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              待完善
            </div>
          )}
          {scopeDefinition.available &&
            showDirectoryResults &&
            directoryResults.length > 0 && (
              <CommandGroup heading="通讯录">
                {directoryResults.map((item) => (
                  <CommandItem
                    key={`${item.type}:${item.id}`}
                    onSelect={() => selectDirectoryItem(item)}
                    value={`directory:${item.type}:${item.id}`}
                  >
                    <DirectorySearchResultAvatar item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {getDirectorySearchItemName(item)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {getDirectorySearchItemDescription(item)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          {scopeDefinition.available &&
            showConversationResults &&
            conversationResults.length > 0 && (
              <CommandGroup heading="会话">
                {conversationResults.map((result) => (
                  <CommandItem
                    key={result.conversation.id}
                    onSelect={() => selectConversation(result.conversation.id)}
                    value={`conversation:${result.conversation.id}`}
                  >
                    <ConversationAvatar
                      className="size-8"
                      conversation={result.conversation}
                      sourceAvatarClassName="size-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {getConversationDisplayName(result.conversation)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {getConversationResultDescription(
                          result,
                          keyword,
                          getConversationDescription
                        )}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          {scopeDefinition.available &&
            showMessageResults &&
            messageResults.length > 0 && (
              <CommandGroup heading="聊天记录">
                {messageResults.map((result) => (
                  <CommandItem
                    key={result.message.id}
                    onSelect={() => selectMessageResult(result)}
                    value={`message:${result.message.id}`}
                  >
                    <MessageSearchResultAvatar result={result} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="min-w-0 flex-1 truncate">
                          {result.conversation.name || "会话"}
                        </span>
                        <span className="shrink-0 text-xs font-normal text-muted-foreground">
                          {formatActivityTime(result.message.createdAt)}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {result.senderName}：{result.summary}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
        </CommandList>
      </CommandDialog>
    </>
  )
}

function GlobalSearchEmptyState({
  description,
  state,
}: {
  description?: string
  state?: "idle" | "no-results"
}) {
  const isIdle = state === "idle"

  return (
    <Empty className="min-h-48 rounded-none p-8">
      <EmptyMedia variant="icon">
        {isIdle ? <Search /> : <SearchX />}
      </EmptyMedia>
      <EmptyHeader>
        <EmptyDescription>
          {description ?? (isIdle ? "输入关键词开始搜索" : "未找到相关内容")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function GlobalSearchLoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      正在搜索
    </div>
  )
}

function getClientSearchScope(scope: GlobalSearchScope): ClientSearchScope {
  if (
    scope === "directory" ||
    scope === "conversation" ||
    scope === "messages"
  ) {
    return scope
  }
  return "all"
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
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

  const name = getDirectorySearchItemName(item)
  return (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {item.avatar && (
        <AvatarImage alt={name} className="rounded-sm" src={item.avatar} />
      )}
      <AvatarFallback className="rounded-sm">
        {item.type === "app" ? (
          <Bot className="size-4" />
        ) : (
          getAvatarInitial(name)
        )}
      </AvatarFallback>
    </Avatar>
  )
}

function MessageSearchResultAvatar({
  result,
}: {
  result: ClientMessageSearchResult
}) {
  const name = result.conversation.name || "会话"
  return (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {result.conversation.avatar && (
        <AvatarImage
          alt={name}
          className="rounded-sm"
          src={result.conversation.avatar}
        />
      )}
      <AvatarFallback className="rounded-sm">
        {result.conversation.type === "app" ? (
          <Bot className="size-4" />
        ) : (
          getAvatarInitial(name)
        )}
      </AvatarFallback>
    </Avatar>
  )
}

function getDirectorySearchItemName(item: DirectorySearchItem) {
  return item.type === "user"
    ? item.nickname.trim() || item.name.trim()
    : item.name.trim()
}

function getDirectorySearchItemDescription(item: DirectorySearchItem) {
  if (item.type === "user") {
    return item.email.trim() || item.phone.trim() || "联系人"
  }
  if (item.type === "app") {
    return item.description.trim() || "应用"
  }
  return `${item.memberCount} 位成员${item.joined ? " · 已加入" : ""}`
}

function getConversationResultDescription(
  result: ConversationSearchResult,
  keyword: string,
  getConversationDescription: (conversation: ClientConversation) => string
) {
  if (!keyword.trim()) {
    return getConversationDescription(result.conversation)
  }

  const field = result.matchedField
  if (!field || field.kind === "conversation_name") {
    return "匹配会话名称"
  }

  const displayName = field.memberDisplayName
  const value = field.rawValue
  return displayName && displayName !== value
    ? `${getConversationMatchLabel(field)}：${displayName} · ${value}`
    : `${getConversationMatchLabel(field)}：${value}`
}

function getConversationMatchLabel(field: ConversationSearchField) {
  if (field.kind === "member_email") {
    return "匹配邮箱"
  }
  if (field.kind === "member_phone") {
    return "匹配手机号"
  }
  if (field.kind === "app_name") {
    return "匹配应用成员"
  }
  return "匹配成员"
}
