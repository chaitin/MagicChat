import type { LocalSearchSection } from "../../shared/account-data"

const nameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
})

export function sortedSearchSection<T extends { id: string }>(
  items: T[],
  limit: number,
  displayName: (item: T) => string,
): LocalSearchSection<T> {
  items.sort((left, right) => {
    const compared = nameCollator.compare(displayName(left), displayName(right))
    return compared || left.id.localeCompare(right.id)
  })
  return limitSearchSection(items, limit)
}

export function limitSearchSection<T>(items: T[], limit: number): LocalSearchSection<T> {
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit,
  }
}
