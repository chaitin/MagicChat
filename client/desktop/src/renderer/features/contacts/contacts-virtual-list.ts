export const CONTACT_ROW_HEIGHT = 66
export const CONTACT_ITEM_HEIGHT = 62

const HEADER_HEIGHT = 40
const GAP = 4
const OVERSCAN = CONTACT_ROW_HEIGHT * 3

type Section = { key: string; count: number; expanded: boolean }

export function visibleContactRanges(
  sections: readonly Section[],
  scrollTop: number,
  viewportHeight: number,
): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>()
  let top = GAP // 列表顶部内边距

  for (const section of sections) {
    if (section.count === 0) continue
    if (section.expanded) {
      const itemsTop = top + HEADER_HEIGHT + GAP + GAP
      const start = Math.max(
        0,
        Math.min(section.count, Math.floor((scrollTop - itemsTop - OVERSCAN) / CONTACT_ROW_HEIGHT)),
      )
      const end = Math.max(
        start,
        Math.min(
          section.count,
          Math.ceil((scrollTop + viewportHeight - itemsTop + OVERSCAN) / CONTACT_ROW_HEIGHT),
        ),
      )
      ranges.set(section.key, { start, end })
      top += HEADER_HEIGHT + GAP + section.count * CONTACT_ROW_HEIGHT + GAP
    } else {
      top += HEADER_HEIGHT
    }
    top += GAP // 分组间距
  }
  return ranges
}
