import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import MarkdownIt from "markdown-it"
import ts from "typescript"
import { xguiColors } from "../src/xgui/theme/colors.ts"

type Element = { type: string | Function; props: Record<string, any>; children: any[] }
const source = readFileSync(new URL("../src/features/conversation/messages/markdown-message.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("markdown-message.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const code = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n")
const compiled = ts.transpileModule(`${code}\nexport { MarkdownImage, MarkdownTable, MarkdownInlineCode, getInlineCodeGeometry, getMarkdownImageFrame, parseTaskListItem, buildTokenTree }`, {
  fileName: "markdown-message.tsx", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
const flatten = (style: any): Record<string, any> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {}
function* walk(node: any): Generator<Element> {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return }
  if (!node || typeof node !== "object") return
  yield node
  for (const child of node.children ?? []) yield* walk(child)
}
const findAll = (root: Element, type: string | Function) => [...walk(root)].filter((item) => item.type === type)

function fixture() {
  let scheme: "light" | "dark" = "light"
  let viewportWidth = 360
  let fontScale = 1
  let cursor = 0
  const states: any[] = []
  const pushes: string[] = []
  const opened: string[] = []
  const exports: any = {}
  runInNewContext(compiled, {
    exports, URL, Number, Math, JSON, MarkdownIt,
    React: { createElement: (type: string | Function, props: any, ...children: any[]) => type === exports.MarkdownInlineCode ? exports.MarkdownInlineCode(props) : ({ type, props: props ?? {}, children }) },
    memo: (fn: Function) => fn, useMemo: (fn: Function) => fn(),
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
      return [states[index], (next: any) => { states[index] = typeof next === "function" ? next(states[index]) : next }]
    },
    useXGUITheme: () => ({ colors: xguiColors[scheme], colorScheme: scheme }),
    useWindowDimensions: () => ({ width: viewportWidth, fontScale, scale: 3 }),
    useRouter: () => ({ push: (href: string) => pushes.push(href) }),
    buildUrlImagePreviewHref: (url: string) => `preview:${url}`,
    View: "View", Text: "Text", ScrollView: "ScrollView", Image: "Image", Pressable: "Pressable", MessageMentionText: "Mentions", Check: "Check",
    StyleSheet: { create: (style: unknown) => style, hairlineWidth: 1 },
    Linking: { openURL: (url: string) => { opened.push(url); return Promise.resolve() } },
  })
  const render = (content: string, selectable = true): Element => { cursor = 0; return exports.MarkdownMessage({ content, selectable, currentUserId: "me", serverUrl: "https://example.test", onMentionPress() {}, resolveMentionLabel: () => "Alice" }) }
  return {
    ...exports, render, pushes, opened,
    setScheme: (value: typeof scheme) => { scheme = value },
    setViewport: (value: number) => { viewportWidth = value },
    setFontScale: (value: number) => { fontScale = value },
    renderInlineCode: (props: any): Element => { cursor = 0; return exports.MarkdownInlineCode(props) },
    renderImage: (token: any): Element => { cursor = 0; return exports.MarkdownImage({ serverUrl: "https://example.test", token }) },
    renderTable: (props: any): Element => { cursor = 0; return exports.MarkdownTable(props) },
  }
}

function imageToken(src = "/image.png") {
  return { attrGet: (name: string) => name === "src" ? src : null, content: "图片" }
}

test("正文保留15/23，段落间距16，H1到H6采用desktop层级且内联样式不覆盖标题字号", () => {
  const f = fixture()
  const tree = f.render("普通段落\n\n第二段落")
  assert.equal(tree.props.style.gap, 16)
  for (const text of findAll(tree, "Text")) {
    assert.equal(flatten(text.props.style).fontSize, 15)
    assert.equal(flatten(text.props.style).lineHeight, 23)
  }
  for (const [level, size] of [24, 20, 18, 16, 14, 14].entries()) {
    const root = f.render(`${"#".repeat(level + 1)} 标题 **粗体** *斜体* [链接](https://example.test)`)
    const texts = findAll(root, "Text")
    assert.equal(flatten(texts[0].props.style).fontSize, size)
    assert.equal(flatten(texts[0].props.style).lineHeight, Math.round(size * 1.375))
    assert.equal(flatten(texts[0].props.style).fontWeight, "600")
    for (const inline of texts.slice(1)) assert.equal(flatten(inline.props.style).fontSize, undefined)
  }
})

test("行内代码使用foreground/8和圆角，随正文/标题比例缩放；引用块与删除线使用次要文字色", () => {
  const f = fixture()
  for (const scheme of ["light", "dark"] as const) {
    f.setScheme(scheme)
    const expectedCode = scheme === "dark" ? "rgba(255,255,255,0.064)" : "rgba(0,0,0,0.072)"
    const root = f.render("`inline`\n\n# `heading`\n\n> 引用 **粗体**\n\n~~删除 **粗体**~~\n\n---")
    const texts = findAll(root, "Text")
    const inlineCode = texts.filter((text) => flatten(text.props.style).fontFamily?.startsWith("JetBrainsMono"))
    assert.deepEqual(inlineCode.map((text) => flatten(text.props.style).fontSize), [14, 22])
    for (const text of inlineCode) {
      const style = flatten(text.props.style)
      const container = findAll(root, "View").find((view) => view.children.includes(text))!
      const containerStyle = flatten(container.props.style)
      assert.equal(containerStyle.backgroundColor, expectedCode)
      assert.equal(containerStyle.borderRadius, 4)
      assert.equal(containerStyle.paddingHorizontal, 4)
      assert.equal(containerStyle.paddingVertical, 2)
      assert.equal(containerStyle.overflow, "hidden")
      assert.equal(containerStyle.maxWidth, "100%")
      assert.equal(style.color, xguiColors[scheme].textPrimary)
      assert.equal(style.paddingHorizontal, undefined)
      assert.equal(style.includeFontPadding, false)
      assert.equal(text.props.selectable, true)
    }
    const quote = findAll(root, "View").find((view) => view.props.style?.borderLeftWidth === 2)!
    assert.equal(quote.props.style.paddingVertical, 8)
    assert.equal(quote.props.style.paddingLeft, 12)
    assert.equal(quote.props.style.backgroundColor, scheme === "dark" ? "rgba(255,255,255,0.040)" : "rgba(0,0,0,0.045)")
    for (const text of findAll(quote, "Text")) assert.equal(flatten(text.props.style).color, xguiColors[scheme].textSecondary)
    const strike = texts.find((text) => flatten(text.props.style).textDecorationLine === "line-through")!
    for (const text of findAll(strike, "Text")) assert.equal(flatten(text.props.style).color, xguiColors[scheme].textSecondary)
    const rule = findAll(root, "View").find((view) => view.props.style?.height === 1)!
    assert.equal(rule.props.style.opacity, 0.2)
  }
})

test("行内代码保留粗体、斜体、删除线和标题继承，背景高度小于正文行高", () => {
  const f = fixture()
  const root = f.render("`code`\n\n**`bold`**\n\n*`italic`*\n\n~~`deleted`~~\n\n# `heading`", false)
  const code = findAll(root, "Text").filter((text) => flatten(text.props.style).fontFamily?.startsWith("JetBrainsMono"))
  assert.equal(code.length, 5)
  assert.equal(flatten(code[1].props.style).fontFamily, "JetBrainsMono-SemiBold")
  assert.equal(flatten(code[2].props.style).fontFamily, "JetBrainsMono-Italic")
  assert.equal(flatten(code[3].props.style).textDecorationLine, "line-through")
  assert.equal(flatten(code[3].props.style).color, xguiColors.light.textSecondary)
  assert.equal(flatten(code[4].props.style).fontFamily, "JetBrainsMono-SemiBold")
  for (const [index, text] of code.entries()) {
    assert.equal(text.props.selectable, false)
    assert.ok(flatten(text.props.style).lineHeight + 4 < (index === 4 ? 33 : 23))
  }
  const combined = f.render("***`bold italic`***")
  const combinedCode = findAll(combined, "Text").find((text) => flatten(text.props.style).fontFamily?.startsWith("JetBrainsMono"))!
  assert.equal(flatten(combinedCode.props.style).fontFamily, "JetBrainsMono-SemiBoldItalic")
  assert.equal(flatten(combinedCode.props.style).fontWeight, "400")
  assert.equal(flatten(combinedCode.props.style).fontStyle, "normal")
  const paragraph = f.render("之前 `inline` 之后")
  const inlineText = findAll(paragraph, "Text").find((text) => flatten(text.props.style).fontFamily?.startsWith("JetBrainsMono"))!
  const container = findAll(paragraph, "View").find((view) => view.children.includes(inlineText))!
  const attachment = findAll(paragraph, "View").find((view) => view.children.includes(container))!
  assert.equal(attachment.props.collapsable, false)
  assert.ok(findAll(paragraph, "Text").some((text) => text.children[0]?.includes?.(attachment)))
})

test("行内代码按正文升降部实测居中，按完整背景宽度占位，不受0.85系统字号影响", () => {
  for (const fontScale of [0.85, 1, 1.3, 2]) {
    const f = fixture()
    f.setFontScale(fontScale)
    const props = { backgroundColor: "gray", bodyFontSize: 15, color: "black", content: "code", fontFamily: "JetBrainsMono", lineHeight: 23, selectable: true }
    let root = f.renderInlineCode(props)
    const probe = findAll(root, "Text").find((text) => text.props.onTextLayout)!
    assert.equal(probe.props.accessible, false)
    assert.equal(probe.props.pointerEvents, "none")
    assert.equal(probe.props.style.opacity, 0)
    probe.props.onTextLayout({ nativeEvent: { lines: [{ ascender: 17, descender: 6 }] } })
    const box = findAll(root, "View").find((view) => view.props.onLayout)!
    box.props.onLayout({ nativeEvent: { layout: { width: 241 / 3, height: 21 } } })
    root = f.renderInlineCode(props)
    const background = findAll(root, "View").find((view) => view.props.onLayout)!
    assert.equal(root.props.collapsable, false)
    assert.equal(root.props.style.maxWidth, undefined)
    assert.equal(background.props.style.position, "absolute")
    assert.equal(background.props.style.width, 241 / 3)
    assert.equal(root.props.style.width, background.props.style.width, "View自身不放大，不能靠超出段落最大宽度来补偿")
    assert.equal(background.props.style.top, 1)
    const spWidth = Math.floor(Math.ceil((root.props.style.width + 0.01) * 3) * fontScale)
    const spHeight = Math.floor(Math.ceil((root.props.style.height + 0.01) * 3) * fontScale)
    const reservedWidth = Math.ceil((spWidth + 1) / fontScale) / 3
    const reservedAscent = Math.round(spHeight / fontScale) / 3
    assert.ok(reservedWidth >= background.props.style.width, "包含左右padding的背景不得侵入后续文字占位")
    assert.ok(Math.abs(reservedAscent - 17) <= 1 / 3 + 1e-9)
    assert.equal(background.props.style.top + 21 / 2 - 17, (6 - 17) / 2, "背景中心和正文行中心相同，而非底边贴基线")
    assert.equal(findAll(background, "Text")[0].props.selectable, true)
    assert.equal(f.renderInlineCode(props).props.style.width, root.props.style.width)
    f.setViewport(600)
    assert.equal(f.renderInlineCode(props).props.style.width, undefined)
  }
})

test("行内代码使用完整盒子实测宽高，长代码不挤占下一行，内容/字体变化重新测量", () => {
  const f = fixture()
  const geometry = f.getInlineCodeGeometry({ width: 180, height: 48 }, { ascender: 17, descender: 6 })
  assert.equal(geometry.ascent + 6, 48)
  assert.equal(geometry.top, 0)
  assert.equal(geometry.width, 180)
  const props = { backgroundColor: "gray", bodyFontSize: 15, color: "black", content: "code", fontFamily: "JetBrainsMono", lineHeight: 23, selectable: false }
  const root = f.renderInlineCode(props)
  findAll(root, "Text").find((text) => text.props.onTextLayout)!.props.onTextLayout({ nativeEvent: { lines: [{ ascender: 17, descender: 6 }] } })
  findAll(root, "View").find((view) => view.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { width: 180, height: 48 } } })
  assert.equal(f.renderInlineCode(props).props.style.height, 42)
  assert.equal(f.renderInlineCode({ ...props, content: "changed" }).props.style.height, undefined)
  assert.equal(f.renderInlineCode({ ...props, fontFamily: "JetBrainsMono-SemiBold" }).props.style.width, undefined)
})

test("有序/无序列表项间距4，保留起始序号与嵌套列表", () => {
  const f = fixture()
  for (const content of ["- 第一项\n- 第二项\n  - 嵌套", "3. 第三项\n4. 第四项"]) {
    const root = f.render(content)
    const list = root.children[0][0] as Element
    assert.equal(list.props.style.gap, 4)
    assert.ok(findAll(root, "View").some((view) => view.props.style?.paddingLeft === 4))
    if (content.startsWith("3.")) assert.ok(findAll(root, "Text").some((text) => text.children.includes("3.")))
  }
})

test("复杂列表每层固定20加4缩进，多位序号悬挂且不挤动正文，列表项内段落/子列表不额外加间距", () => {
  const f = fixture()
  const root = f.render("98. outer\n\n    continuation\n\n    - nested\n      1. deep\n      2. deep2\n99. next\n100. last")
  const markers = findAll(root, "Text").filter((text) => flatten(text.props.style).right === "100%")
  assert.deepEqual(markers.map((text) => text.children[0]), ["98.", "•", "1.", "2.", "99.", "100."])
  for (const marker of markers) {
    const style = flatten(marker.props.style)
    assert.equal(style.position, "absolute")
    assert.equal(style.top, 0)
    assert.equal(style.width, undefined)
    assert.equal(style.minWidth, undefined)
    const item = findAll(root, "View").find((view) => view.children.includes(marker))!
    assert.equal(item.props.style.marginLeft, 20)
    assert.equal(item.props.style.paddingLeft, 4)
    const body = item.children[1] as Element
    assert.equal(body.props.style.gap, undefined)
    assert.equal(body.props.style.minWidth, 0)
  }
  function indent(node: any, content: string, left = 0): number | undefined {
    if (Array.isArray(node)) {
      for (const child of node) { const result = indent(child, content, left); if (result !== undefined) return result }
      return undefined
    }
    if (!node || typeof node !== "object") return undefined
    const style = flatten(node.props.style)
    if (node.type === "View") left += (style.marginLeft ?? 0) + (style.paddingLeft ?? 0)
    if (node.type === "Mentions" && node.props.content === content) return left
    return indent(node.children, content, left)
  }
  assert.equal(indent(root, "outer"), 24)
  assert.equal(indent(root, "continuation"), 24)
  assert.equal(indent(root, "nested"), 48)
  assert.equal(indent(root, "deep"), 72)
  assert.equal(indent(root, "next"), 24)
  assert.equal(indent(root, "last"), 24)
})

test("松散任务列表内的续段、引用、代码和子列表保持纵向排列，保留只读选择框及有序任务缩进", () => {
  const f = fixture()
  const root = f.render("- [x] first\n\n  second **bold**\n\n  > quote\n\n  ```ts\n  code\n  ```\n\n  - nested\n- plain")
  const checkbox = findAll(root, "View").find((view) => view.props.accessibilityRole === "checkbox")!
  const item = findAll(root, "View").find((view) => view.children.includes(checkbox))!
  assert.equal(item.props.style.flexDirection, "row")
  assert.equal(item.props.style.gap, 8)
  assert.equal(item.props.style.marginLeft, 0)
  const body = item.children[1] as Element
  assert.equal(body.props.style.gap, undefined)
  assert.equal(body.props.style.flexShrink, 1)
  const blocks = body.children[0] as Element[]
  assert.equal(blocks.length, 5)
  assert.equal(findAll(blocks[2], "View")[0].props.style.borderLeftWidth, 2)
  assert.equal(typeof blocks[3].type, "function")
  assert.equal(blocks[3].type.name, "MarkdownCodeBlock")
  assert.equal(findAll(blocks[4], "Text").filter((text) => text.children.includes("•")).length, 1)
  assert.equal(checkbox.props.accessibilityState.checked, true)
  assert.equal(checkbox.props.accessibilityState.disabled, true)
  const ordered = f.render("3. [ ] task\n4. next")
  const orderedBox = findAll(ordered, "View").find((view) => view.props.accessibilityRole === "checkbox")!
  const orderedItem = findAll(ordered, "View").find((view) => view.children.includes(orderedBox))!
  assert.equal(orderedItem.props.style.marginLeft, 20)
  assert.ok(findAll(ordered, "Text").some((text) => text.children.includes("4.")))
})

test("Markdown任务列表使用16尺寸只读选择框，勾选、嵌套和内容格式保留", () => {
  const f = fixture()
  for (const scheme of ["light", "dark"] as const) {
    f.setScheme(scheme)
    const root = f.render("- [ ] **todo**\n- [x] [done](https://example.test)\n  - [X] nested\n- plain")
    const boxes = findAll(root, "View").filter((view) => view.props.accessibilityRole === "checkbox")
    assert.deepEqual(boxes.map((box) => box.props.accessibilityState.checked), [false, true, true])
    for (const box of boxes) {
      assert.equal(box.props.accessibilityState.disabled, true)
      assert.equal(box.props.pointerEvents, "none")
      assert.equal(box.props.onPress, undefined)
      assert.equal(box.props.style.width, 16)
      assert.equal(box.props.style.height, 16)
      assert.equal(box.props.style.borderRadius, 4)
      const checked = box.props.accessibilityState.checked
      assert.equal(box.props.style.backgroundColor, checked ? xguiColors[scheme].textPrimary : "transparent")
      assert.equal(findAll(box, "Check").length, checked ? 1 : 0)
    }
    assert.ok(findAll(root, "Text").some((text) => flatten(text.props.style).fontWeight === "600"))
    assert.ok(findAll(root, "Text").some((text) => typeof text.props.onPress === "function"))
    const text = findAll(root, "Mentions").map((node) => node.props.content).join("")
    assert.equal(text.includes("[x]"), false)
    assert.equal(text.includes("[ ]"), false)
    assert.ok(findAll(root, "Text").some((node) => node.children.includes("•")))
  }
})

test("任务标记只在列表首个普通文本识别，不改动普通段落/代码，且不修改缓存token", () => {
  const f = fixture()
  const root = f.render("[x] 普通段落\n\n- `[x] code`\n- **[x] bold**\n- [x]no-space\n- [ ]")
  assert.equal(findAll(root, "View").filter((view) => view.props.accessibilityRole === "checkbox").length, 1)
  assert.ok(findAll(root, "Mentions").some((node) => node.props.content === "[x] 普通段落"))
  const tree = f.buildTokenTree(new MarkdownIt().parse("- [x] task", {}))
  const item = tree[0].children[0]
  const first = item.children[0].children[0].token.children[0]
  const task = f.parseTaskListItem(item)
  assert.equal(first.content, "[x] task")
  assert.equal(task.children[0].children[0].token.children[0].content, "task")
  assert.equal(typeof task.children[0].children[0].token.attrGet, "function")
})

test("段落内图片保留原始图文顺序，图片两侧的粗体/链接等内联样式不丢失", () => {
  const f = fixture()
  const root = f.render("**之前 ![图](/image.png) 之后**")
  const paragraph = root.children[0][0] as Element
  const parts = paragraph.children[0] as Element[]
  assert.equal(parts.length, 3)
  assert.deepEqual(Array.from(parts, (part) => typeof part.type === "function" ? part.type.name : part.type), ["Text", "MarkdownImage", "Text"])
  for (const part of [parts[0], parts[2]]) assert.ok(findAll(part, "Text").some((text) => flatten(text.props.style).fontWeight === "600"))
  const imageOnly = f.render("![first](/a.png) ![second](/b.png)")
  assert.equal(findAll(imageOnly, "Text").length, 0)
  assert.equal(findAll(imageOnly, f.MarkdownImage).length, 2)
})

test("表格等待全部自然宽度后统一列宽，无固定140列宽或表头铺色，保留对齐/横向滚动", () => {
  const f = fixture()
  const root = f.render("| 左列 | 右列 |\n| :--- | ---: |\n| long text | value |")
  const props = findAll(root, f.MarkdownTable)[0].props
  let table = f.renderTable(props)
  assert.equal(table.props.horizontal, true)
  assert.equal(table.props.nestedScrollEnabled, true)
  const cells = findAll(table, "View").filter((view) => typeof view.props.onLayout === "function")
  assert.equal(cells.length, 4)
  assert.ok(cells.every((cell) => cell.props.style.width === undefined))
  cells[0].props.onLayout({ nativeEvent: { layout: { width: 60 } } })
  table = f.renderTable(props)
  assert.ok(findAll(table, "View").filter((view) => view.props.onLayout).every((cell) => cell.props.style.width === undefined))
  for (const [index, width] of [[1, 180], [2, 100], [3, 300]]) cells[index].props.onLayout({ nativeEvent: { layout: { width } } })
  table = f.renderTable(props)
  const measured = findAll(table, "View").filter((view) => view.props.onLayout)
  assert.deepEqual(measured.map((cell) => cell.props.style.width), [100, 300, 100, 300])
  for (const cell of measured) {
    assert.equal(cell.props.style.paddingHorizontal, 8)
    assert.equal(cell.props.style.paddingVertical, 12)
    assert.equal(cell.props.style.backgroundColor, undefined)
  }
  const texts = findAll(table, "Text")
  assert.deepEqual(texts.map((text) => text.props.style.textAlign), ["left", "right", "left", "right"])
  assert.deepEqual(texts.map((text) => text.props.style.fontWeight), ["600", "600", "400", "400"])
  const changed = findAll(f.render("| 新列 |\n| --- |\n| 值 |"), f.MarkdownTable)[0].props
  assert.ok(findAll(f.renderTable(changed), "View").filter((view) => view.props.onLayout).every((cell) => cell.props.style.width === undefined))
})

test("短表格按实际视口比例补足列宽且包含左边框，长表格及缩窄后保留自然宽度和滚动", () => {
  const f = fixture()
  const props = findAll(f.render("| left | right |\n| :--- | ---: |\n| value | text |"), f.MarkdownTable)[0].props
  let table = f.renderTable(props)
  assert.equal(table.props.style.alignSelf, "stretch")
  assert.equal(table.props.style.maxWidth, "100%")
  table.props.onLayout({ nativeEvent: { layout: { width: 381 } } })
  const cells = findAll(table, "View").filter((view) => view.props.onLayout)
  for (const [index, width] of [60, 90, 100, 40].entries()) cells[index].props.onLayout({ nativeEvent: { layout: { width } } })
  table = f.renderTable(props)
  const filled = findAll(table, "View").filter((view) => view.props.onLayout)
  assert.deepEqual(filled.map((cell) => cell.props.style.width), [200, 180, 200, 180])
  assert.equal(table.props.contentContainerStyle.minWidth, 381)
  assert.equal(filled[0].props.style.width + filled[1].props.style.width + 1, 381)
  assert.deepEqual(findAll(table, "Text").map((text) => text.props.style.textAlign), ["left", "right", "left", "right"])
  assert.ok(findAll(table, "Text").every((text) => text.props.selectable))
  filled[0].props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  table.props.onLayout({ nativeEvent: { layout: { width: 571 } } })
  table = f.renderTable(props)
  assert.deepEqual(findAll(table, "View").filter((view) => view.props.onLayout).map((cell) => cell.props.style.width), [300, 270, 300, 270])
  table.props.onLayout({ nativeEvent: { layout: { width: 81 } } })
  table = f.renderTable(props)
  assert.deepEqual(findAll(table, "View").filter((view) => view.props.onLayout).map((cell) => cell.props.style.width), [100, 90, 100, 90])
  assert.equal(table.props.horizontal, true)
  assert.equal(table.props.nestedScrollEnabled, true)
  assert.equal(table.props.contentContainerStyle.minWidth, 81)
})

test("图片按实际比例限制可用宽度与320高度，不放大小图，布局变化后重新适配且保留预览", () => {
  const f = fixture()
  const token = imageToken()
  let tree = f.renderImage(token)
  let image = findAll(tree, "Image")[0]
  image.props.onLoad({ nativeEvent: { source: { width: 1200, height: 600 } } })
  tree = f.renderImage(token)
  assert.equal(tree.props.style.width, 360)
  assert.equal(findAll(tree, "Image")[0].props.style.height, 180)
  tree.props.onLayout({ nativeEvent: { layout: { width: 240 } } })
  tree = f.renderImage(token)
  assert.equal(tree.props.style.width, 240)
  assert.equal(findAll(tree, "Image")[0].props.style.height, 120)
  tree.props.onPress()
  assert.deepEqual(f.pushes, ["preview:https://example.test/image.png"])
  f.setViewport(640)
  tree = f.renderImage(token)
  assert.equal(tree.props.style.width, 640)
  assert.equal(findAll(tree, "Image")[0].props.style.height, 320)
  image = findAll(tree, "Image")[0]
  image.props.onLoad({ nativeEvent: { source: { width: 100, height: 1000 } } })
  tree = f.renderImage(token)
  assert.equal(tree.props.style.width, 32)
  assert.equal(findAll(tree, "Image")[0].props.style.height, 320)
  image = findAll(tree, "Image")[0]
  image.props.onLoad({ nativeEvent: { source: { width: 120, height: 80 } } })
  tree = f.renderImage(token)
  assert.equal(tree.props.style.width, 120)
  assert.equal(findAll(tree, "Image")[0].props.style.height, 80)
  assert.equal(tree.props.style.maxWidth, "100%")
})

test("图片和链接仍拒绝危险协议，HTML不作为原生组件执行", () => {
  const f = fixture()
  const invalid = f.renderImage(imageToken("javascript:alert(1)"))
  assert.equal(invalid.type, "Text")
  assert.equal(findAll(invalid, "Image").length, 0)
  const root = f.render("<script>alert(1)</script>\n\n[链接](https://example.test)")
  assert.ok([...walk(root)].every((element) => element.type !== "script"))
  const link = findAll(root, "Text").find((text) => typeof text.props.onPress === "function")!
  link.props.onPress()
  assert.deepEqual(f.opened, ["https://example.test/"])
})
