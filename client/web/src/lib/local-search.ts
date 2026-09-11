import type {
  ClientConversation,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import {
  createConversationSearchIndex,
  searchConversationIndex,
  type ConversationSearchField,
  type ConversationSearchResult,
} from "@/lib/conversation-search"
import {
  createDirectorySearchIndex,
  searchDirectoryIndex,
  type DirectorySearchItem,
} from "@/lib/directory-search"

export type LocalSearchScope = "all" | "directory" | "conversation"

export type LocalSearchRequest = {
  keyword: string
  scope: LocalSearchScope
}

export type LocalSearchResults = {
  conversations: ConversationSearchResult[]
  directory: DirectorySearchItem[]
}

export type LocalSearchService = {
  search: (request: LocalSearchRequest) => LocalSearchResults
}

export function createLocalSearchService({
  apps,
  contacts,
  conversations,
  currentUserId,
  groups,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  groups: ContactGroup[]
}): LocalSearchService {
  const directoryIndex = createDirectorySearchIndex({
    apps,
    groups,
    users: contacts.filter((contact) => contact.id !== currentUserId),
  })
  const conversationIndex = createConversationSearchIndex(
    conversations,
    currentUserId
  )

  return {
    search({ keyword, scope }) {
      if (!keyword.trim()) {
        return createEmptyResults()
      }

      return {
        conversations:
          scope === "all" || scope === "conversation"
            ? searchConversationIndex(conversationIndex, keyword)
            : [],
        directory:
          scope === "all" || scope === "directory"
            ? searchDirectoryIndex(directoryIndex, keyword)
            : [],
      }
    },
  }
}

function createEmptyResults(): LocalSearchResults {
  return {
    conversations: [],
    directory: [],
  }
}

export type {
  ConversationSearchField,
  ConversationSearchResult,
  DirectorySearchItem,
}
