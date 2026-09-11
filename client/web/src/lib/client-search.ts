import type {
  ClientConversation,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
  SearchClientMessagesInput,
} from "@/lib/client-data-api"
import { searchClientMessages } from "@/lib/client-data-api"
import {
  createLocalSearchService,
  type ConversationSearchResult,
  type DirectorySearchItem,
  type LocalSearchScope,
} from "@/lib/local-search"

export type ClientSearchScope =
  "all" | "directory" | "conversation" | "messages"

export type ClientSearchRequest = {
  keyword: string
  scope: ClientSearchScope
}

export type ClientSearchResults = {
  conversations: ConversationSearchResult[]
  directory: DirectorySearchItem[]
  messages: ClientMessageSearchResult[]
}

export type ClientSearchOptions = {
  signal?: AbortSignal
}

export type MessageSearchProvider = (
  input: SearchClientMessagesInput
) => Promise<ClientMessageSearchResult[]>

export type ClientSearchService = {
  search: (
    request: ClientSearchRequest,
    options?: ClientSearchOptions
  ) => Promise<ClientSearchResults>
}

export function createClientSearchService({
  apps,
  contacts,
  conversations,
  currentUserId,
  groups,
  messageSearch = searchClientMessages,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  groups: ContactGroup[]
  messageSearch?: MessageSearchProvider
}): ClientSearchService {
  const localSearch = createLocalSearchService({
    apps,
    contacts,
    conversations,
    currentUserId,
    groups,
  })

  return {
    async search({ keyword, scope }, options = {}) {
      const normalizedKeyword = keyword.trim()
      if (!normalizedKeyword) {
        return createEmptyClientSearchResults()
      }
      const localResults = localSearch.search({
        keyword: normalizedKeyword,
        scope: getLocalScope(scope),
      })
      const shouldSearchMessages =
        (scope === "all" || scope === "messages") &&
        Array.from(normalizedKeyword).length >= 2
      const messages = shouldSearchMessages
        ? await messageSearch({
            keyword: normalizedKeyword,
            signal: options.signal,
          })
        : []

      return {
        conversations: scope === "messages" ? [] : localResults.conversations,
        directory: scope === "messages" ? [] : localResults.directory,
        messages,
      }
    },
  }
}

function getLocalScope(scope: ClientSearchScope): LocalSearchScope {
  if (scope === "directory" || scope === "conversation") {
    return scope
  }
  return "all"
}

function createEmptyClientSearchResults(): ClientSearchResults {
  return {
    conversations: [],
    directory: [],
    messages: [],
  }
}
