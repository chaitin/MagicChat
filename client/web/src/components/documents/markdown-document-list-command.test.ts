import { describe, expect, it } from "vitest"

import { transformMarkdownList } from "./markdown-document-list-command"

describe("transformMarkdownList", () => {
  it("starts lists on an empty line", () => {
    expect(transformMarkdownList("", "bullet")).toBe("- ")
    expect(transformMarkdownList("", "ordered")).toBe("1. ")
    expect(transformMarkdownList("", "task")).toBe("- [ ] ")
  })

  it("preserves blank lines without consuming ordered list numbers", () => {
    expect(transformMarkdownList("第一项\n\n第二项", "ordered")).toBe(
      "1. 第一项\n\n2. 第二项"
    )
  })

  it("preserves blank lines when removing a list", () => {
    expect(transformMarkdownList("- 第一项\n\n- 第二项", "bullet")).toBe(
      "第一项\n\n第二项"
    )
  })

  it("converts existing list markers while preserving indentation", () => {
    expect(transformMarkdownList("  - 第一项\n  - 第二项", "task")).toBe(
      "  - [ ] 第一项\n  - [ ] 第二项"
    )
  })
})
