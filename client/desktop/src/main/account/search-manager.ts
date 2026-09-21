import type {
  LocalSearchAppResult,
  LocalSearchCategory,
  LocalSearchContactResult,
  LocalSearchGroupResult,
  LocalSearchInput,
  LocalSearchMessageResult,
  LocalSearchResponse,
  LocalSearchSection,
} from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import type { AccountDatabase } from "./account-database"
import { limitSearchSection, sortedSearchSection } from "./search-ranking"

const COMBINED_LIMIT = 3
const CATEGORY_LIMIT = 100
const categories = new Set<LocalSearchCategory>(["all", "contacts", "apps", "groups", "messages"])
export class SearchManager {
  private readonly database: AccountDatabase

  constructor(database: AccountDatabase) {
    this.database = database
  }

  search(input: Omit<LocalSearchInput, "targetId">): LocalSearchResponse {
    const category = input?.category
    const query = typeof input?.query === "string" ? input.query.trim().toLocaleLowerCase() : ""
    if (!categories.has(category) || !query || query.length > 256) {
      throw new AuthFailure("invalid_search", "请输入有效的搜索关键词")
    }
    const limit = category === "all" ? COMBINED_LIMIT : CATEGORY_LIMIT
    const response = emptyResponse()

    if (category === "all" || category === "contacts") {
      response.contacts = sortedSearchSection(
        this.database.searchContacts(query),
        limit,
        (item) => item.nickname || item.name,
      )
    }
    if (category === "all" || category === "apps") {
      response.apps = sortedSearchSection(
        this.database.searchApps(query),
        limit,
        (item) => item.name,
      )
    }
    if (category === "all" || category === "groups") {
      response.groups = sortedSearchSection(
        this.database.searchGroups(query),
        limit,
        (item) => item.name,
      )
    }
    if (category === "all" || category === "messages") {
      const items = this.database.searchMessages(query, limit + 1)
      response.messages = limitSearchSection(items, limit)
    }
    return response
  }
}

function emptyResponse(): LocalSearchResponse {
  return {
    contacts: emptySection<LocalSearchContactResult>(),
    apps: emptySection<LocalSearchAppResult>(),
    groups: emptySection<LocalSearchGroupResult>(),
    messages: emptySection<LocalSearchMessageResult>(),
  }
}

function emptySection<T>(): LocalSearchSection<T> {
  return { items: [], hasMore: false }
}
