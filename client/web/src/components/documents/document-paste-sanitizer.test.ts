import { describe, expect, it } from "vitest"

import { sanitizeDocumentPasteHTML } from "./document-paste-sanitizer"

describe("document paste sanitizer", () => {
  it("removes source-specific styling while preserving supported formatting", () => {
    const result = sanitizeDocumentPasteHTML(`
      <meta name="generator" content="Word">
      <p class="MsoNormal" style="margin: 20px; font: 24px Arial; line-height: 2; text-align: justify">
        <span style="font-weight: 700; font-style: italic; text-decoration: underline line-through">格式&nbsp;文本</span>
        <script>alert(1)</script>
      </p>
    `)
    const document = parse(result)
    const paragraph = document.querySelector("p")

    expect(paragraph?.getAttributeNames()).toEqual([])
    expect(paragraph?.textContent?.trim()).toBe("格式 文本")
    expect(paragraph?.querySelector("strong")).not.toBeNull()
    expect(paragraph?.querySelector("em")).not.toBeNull()
    expect(paragraph?.querySelector("u")).not.toBeNull()
    expect(paragraph?.querySelector("s")).not.toBeNull()
    expect(document.querySelector("script")).toBeNull()
    expect(document.querySelector("span")).toBeNull()
  })

  it("keeps supported colors and alignment but removes unsupported values", () => {
    const supportedColor = "oklch(63.7% 0.237 25.331)"
    const result = sanitizeDocumentPasteHTML(`
      <h2 style="text-align: center; font-size: 40px">标题</h2>
      <p style="text-align: right">
        <span style="color: ${supportedColor}; font-family: serif">红色</span>
        <span style="color: rgb(1, 2, 3)">来源颜色</span>
        <mark data-color="${supportedColor}" style="background-color: ${supportedColor}">背景色</mark>
      </p>
    `)
    const document = parse(result)

    expect(document.querySelector("h2")?.getAttribute("style")).toBe(
      "text-align: center"
    )
    expect(document.querySelector("p")?.getAttribute("style")).toBe(
      "text-align: right"
    )
    expect(document.querySelector('span[style*="color"]')?.textContent).toBe(
      "红色"
    )
    expect(document.body.textContent).toContain("来源颜色")
    expect(
      Array.from(document.querySelectorAll("span")).some(
        (span) => span.textContent === "来源颜色"
      )
    ).toBe(false)
    expect(document.querySelector("mark")?.getAttribute("data-color")).toBe(
      supportedColor
    )
  })

  it("preserves task lists, tables, custom rules, and document images", () => {
    const result = sanitizeDocumentPasteHTML(`
      <ul data-type="taskList" class="source-list">
        <li data-type="taskItem" data-checked="true">
          <label><input type="checkbox" checked><span></span></label>
          <div><p>完成事项</p></div>
        </li>
      </ul>
      <table style="width: 900px"><tbody><tr>
        <td colspan="2" rowspan="2" colwidth="120,130" style="padding: 20px"><p>单元格</p></td>
      </tr></tbody></table>
      <hr data-thickness="5" data-line-style="dotted" class="source-rule">
      <figure data-document-image data-file-id="file-1" data-width="65" data-alignment="right" data-alt="图片" class="source-image"><span>旧内容</span></figure>
    `)
    const document = parse(result)

    expect(document.querySelector("ul")?.getAttribute("data-type")).toBe(
      "taskList"
    )
    expect(document.querySelector("li")?.getAttribute("data-checked")).toBe(
      "true"
    )
    expect(document.querySelector("input")).toBeNull()
    expect(document.querySelector("th")?.getAttribute("colwidth")).toBe(
      "120,130"
    )
    expect(document.querySelector("tr")?.querySelector("td")).toBeNull()
    expect(document.querySelector("table")?.getAttribute("style")).toBeNull()
    expect(document.querySelector("hr")?.getAttribute("data-thickness")).toBe(
      "5"
    )
    expect(document.querySelector("hr")?.getAttribute("data-line-style")).toBe(
      "dotted"
    )
    expect(document.querySelector("figure")?.getAttribute("data-file-id")).toBe(
      "file-1"
    )
    expect(document.querySelector("figure")?.getAttribute("data-width")).toBe(
      "65"
    )
  })

  it("converts safe external images and rejects unsafe images and links", () => {
    const result = sanitizeDocumentPasteHTML(`
      <p><a href="https://example.com/path" style="font-size: 20px">安全链接</a></p>
      <p><a href="javascript:alert(1)">危险链接</a></p>
      <img src="https://example.com/image.png" alt="示例图片" style="width: 900px">
      <img src="data:image/png;base64,AAAA" alt="内联图片">
    `)
    const document = parse(result)
    const links = document.querySelectorAll("a")
    const figure = document.querySelector("figure[data-document-image]")

    expect(links[0]?.getAttribute("href")).toBe("https://example.com/path")
    expect(links[1]?.hasAttribute("href")).toBe(false)
    expect(figure?.getAttribute("data-external-url")).toBe(
      "https://example.com/image.png"
    )
    expect(figure?.getAttribute("data-alt")).toBe("示例图片")
    expect(document.body.textContent).not.toContain("内联图片")
  })
})

function parse(html: string) {
  return new DOMParser().parseFromString(html, "text/html")
}
