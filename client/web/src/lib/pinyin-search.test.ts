import { describe, expect, it } from "vitest"

import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"

describe("pinyin search", () => {
  const searchText = createPinyinSearchText(["张小明"])

  it.each(["张小明", "zhangxiaoming", "zhang xiao ming", "zxm"])(
    "matches %s",
    (query) => {
      expect(searchText).toContain(normalizePinyinSearchQuery(query))
    }
  )

  it("keeps searches case-insensitive and ignores query whitespace", () => {
    const latinSearchText = createPinyinSearchText(["Project Alpha"])

    expect(latinSearchText).toContain(
      normalizePinyinSearchQuery(" PROJECTALPHA ")
    )
  })
})
