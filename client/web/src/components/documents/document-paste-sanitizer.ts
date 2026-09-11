const allowedTags = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "EM",
  "H1",
  "H2",
  "H3",
  "HR",
  "LI",
  "MARK",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL",
])

const discardedTags = new Set([
  "BUTTON",
  "CANVAS",
  "COL",
  "COLGROUP",
  "EMBED",
  "FORM",
  "IFRAME",
  "INPUT",
  "LINK",
  "MATH",
  "META",
  "NOSCRIPT",
  "OBJECT",
  "OPTION",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "SVG",
  "TEXTAREA",
])

const blockTags = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "HR",
  "LI",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "UL",
])

const lineStyles = new Set(["dashed", "dotted", "double", "solid"])
const textAlignments = new Set(["center", "left", "right"])

export function sanitizeDocumentPasteHTML(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html")
  sanitizeChildren(document.body)
  return document.body.innerHTML
}

function sanitizeChildren(parent: Element) {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 8) {
      child.remove()
      continue
    }
    if (child instanceof Element) {
      sanitizeElement(child)
      continue
    }
    if (
      child.nodeType === 3 &&
      parent.tagName !== "CODE" &&
      parent.tagName !== "PRE"
    ) {
      child.textContent = child.textContent?.replaceAll("\u00a0", " ") ?? ""
    }
  }
}

function sanitizeElement(originalElement: Element) {
  let element = originalElement
  const originalTag = element.tagName

  if (discardedTags.has(originalTag)) {
    element.remove()
    return
  }

  if (originalTag === "IMG") {
    replaceImage(element)
    return
  }

  if (originalTag === "FIGURE") {
    sanitizeDocumentImage(element)
    return
  }

  if (originalTag === "B") element = replaceTag(element, "strong")
  else if (originalTag === "I") element = replaceTag(element, "em")
  else if (originalTag === "DEL" || originalTag === "STRIKE") {
    element = replaceTag(element, "s")
  } else if (/^H[4-6]$/.test(originalTag)) {
    element = replaceTag(element, "h3")
  }

  const presentation = readPresentation(element)
  sanitizeChildren(element)

  if (
    element.tagName === "DIV" ||
    element.tagName === "ARTICLE" ||
    element.tagName === "SECTION"
  ) {
    if (
      hasBlockChildren(element) ||
      element.closest('li[data-type="taskItem"]')
    ) {
      unwrap(element)
      return
    }
    element = replaceTag(element, "p")
  }

  if (!allowedTags.has(element.tagName)) {
    unwrap(element)
    return
  }

  if (element.tagName === "TABLE") promoteFirstTableRow(element)

  removeAttributes(element)
  restoreSupportedAttributes(element, presentation)
  restoreInlinePresentation(element, presentation)

  if (element.tagName === "SPAN" && !element.hasAttribute("style")) {
    unwrap(element)
  }
}

function readPresentation(element: Element) {
  const htmlElement = element as HTMLElement
  const textDecoration =
    htmlElement.style.textDecorationLine || htmlElement.style.textDecoration
  const numericWeight = Number.parseInt(htmlElement.style.fontWeight, 10)

  return {
    backgroundColor: sanitizeEditorColor(
      element.getAttribute("data-color") || htmlElement.style.backgroundColor
    ),
    bold:
      htmlElement.style.fontWeight === "bold" ||
      htmlElement.style.fontWeight === "bolder" ||
      (Number.isFinite(numericWeight) && numericWeight >= 600),
    checked: element.getAttribute("data-checked"),
    color: sanitizeEditorColor(htmlElement.style.color),
    colspan: element.getAttribute("colspan"),
    colwidth:
      element.getAttribute("colwidth") || element.getAttribute("data-colwidth"),
    fontStyle: htmlElement.style.fontStyle,
    href: element.getAttribute("href"),
    lineStyle: element.getAttribute("data-line-style"),
    listStart: element.getAttribute("start"),
    rowspan: element.getAttribute("rowspan"),
    taskType: element.getAttribute("data-type"),
    textAlign: htmlElement.style.textAlign || element.getAttribute("align"),
    textDecoration,
    thickness: element.getAttribute("data-thickness"),
  }
}

function restoreSupportedAttributes(
  element: Element,
  presentation: ReturnType<typeof readPresentation>
) {
  if (element.tagName === "A") {
    const href = sanitizeLinkURL(presentation.href)
    if (href) element.setAttribute("href", href)
  }

  if (element.tagName === "OL") {
    const start = normalizeInteger(presentation.listStart, 1, 10_000)
    if (start && start !== 1) element.setAttribute("start", String(start))
  }

  if (element.tagName === "UL" && presentation.taskType === "taskList") {
    element.setAttribute("data-type", "taskList")
  }
  if (element.tagName === "LI" && presentation.taskType === "taskItem") {
    element.setAttribute("data-type", "taskItem")
    element.setAttribute(
      "data-checked",
      presentation.checked === "" || presentation.checked === "true"
        ? "true"
        : "false"
    )
  }

  if (element.tagName === "TD" || element.tagName === "TH") {
    const colspan = normalizeInteger(presentation.colspan, 1, 100)
    const rowspan = normalizeInteger(presentation.rowspan, 1, 100)
    const colwidth = sanitizeColumnWidths(presentation.colwidth, colspan ?? 1)
    if (colspan && colspan !== 1)
      element.setAttribute("colspan", String(colspan))
    if (rowspan && rowspan !== 1)
      element.setAttribute("rowspan", String(rowspan))
    if (colwidth) element.setAttribute("colwidth", colwidth)
  }

  if (element.tagName === "HR") {
    const thickness = normalizeInteger(presentation.thickness, 1, 6) ?? 1
    const lineStyle = lineStyles.has(presentation.lineStyle ?? "")
      ? presentation.lineStyle!
      : "solid"
    element.setAttribute("data-line-style", lineStyle)
    element.setAttribute("data-thickness", String(thickness))
  }

  const textAlign = presentation.textAlign
  if (
    (element.tagName === "P" || /^H[1-3]$/.test(element.tagName)) &&
    textAlign &&
    textAlignments.has(textAlign)
  ) {
    element.setAttribute("style", `text-align: ${textAlign}`)
  }
}

function restoreInlinePresentation(
  element: Element,
  presentation: ReturnType<typeof readPresentation>
) {
  if (hasBlockChildren(element)) return

  if (presentation.bold && element.tagName !== "STRONG") {
    wrapChildren(element, "strong")
  }
  if (presentation.fontStyle === "italic" && element.tagName !== "EM") {
    wrapChildren(element, "em")
  }
  if (
    presentation.textDecoration.includes("underline") &&
    element.tagName !== "U"
  ) {
    wrapChildren(element, "u")
  }
  if (
    presentation.textDecoration.includes("line-through") &&
    element.tagName !== "S"
  ) {
    wrapChildren(element, "s")
  }

  if (presentation.backgroundColor) {
    if (element.tagName === "MARK") {
      setHighlightAttributes(element, presentation.backgroundColor)
    } else {
      const mark = wrapChildren(element, "mark")
      setHighlightAttributes(mark, presentation.backgroundColor)
    }
  }

  if (presentation.color) {
    if (element.tagName === "SPAN") {
      element.setAttribute("style", `color: ${presentation.color}`)
    } else {
      const span = wrapChildren(element, "span")
      span.setAttribute("style", `color: ${presentation.color}`)
    }
  }
}

function promoteFirstTableRow(table: Element) {
  let firstRow: Element | undefined
  for (const child of Array.from(table.children)) {
    if (child.tagName === "TR") {
      firstRow = child
      break
    }
    if (
      child.tagName === "THEAD" ||
      child.tagName === "TBODY" ||
      child.tagName === "TFOOT"
    ) {
      firstRow = Array.from(child.children).find((row) => row.tagName === "TR")
      if (firstRow) break
    }
  }

  if (!firstRow) return
  for (const cell of Array.from(firstRow.children)) {
    if (cell.tagName === "TD") replaceTag(cell, "th")
  }
}

function sanitizeDocumentImage(element: Element) {
  if (!element.hasAttribute("data-document-image")) {
    sanitizeChildren(element)
    unwrap(element)
    return
  }

  const alignment = element.getAttribute("data-alignment")
  const alt = (element.getAttribute("data-alt") ?? "").slice(0, 500)
  const externalUrl = sanitizeImageURL(
    element.getAttribute("data-external-url")
  )
  const fileId = sanitizeFileId(element.getAttribute("data-file-id"))
  const width = normalizeImageWidth(element.getAttribute("data-width"))

  removeAttributes(element)
  element.setAttribute("data-document-image", "")
  element.setAttribute(
    "data-alignment",
    alignment === "left" || alignment === "right" ? alignment : "center"
  )
  element.setAttribute("data-alt", alt)
  element.setAttribute("data-width", String(width))
  if (externalUrl) element.setAttribute("data-external-url", externalUrl)
  if (fileId) element.setAttribute("data-file-id", fileId)
  element.replaceChildren(createImageLabel(element.ownerDocument))
}

function replaceImage(element: Element) {
  const source = sanitizeImageURL(element.getAttribute("src"))
  if (!source) {
    element.remove()
    return
  }

  const figure = element.ownerDocument.createElement("figure")
  figure.setAttribute("data-document-image", "")
  figure.setAttribute("data-alignment", "center")
  figure.setAttribute(
    "data-alt",
    (element.getAttribute("alt") ?? "").slice(0, 500)
  )
  figure.setAttribute("data-external-url", source)
  figure.setAttribute("data-width", "100")
  figure.append(createImageLabel(element.ownerDocument))
  element.replaceWith(figure)
}

function createImageLabel(document: Document) {
  const span = document.createElement("span")
  span.textContent = "文档图片"
  return span
}

function sanitizeEditorColor(value: string | null) {
  if (!value) return null
  const color = value.trim().replace(/\s*!important\s*$/i, "")
  if (!/^oklch\([\d.%+\-\s/]+\)$/i.test(color)) return null
  const probe = document.createElement("span")
  probe.style.color = color
  return probe.style.color ? color : null
}

function sanitizeLinkURL(value: string | null) {
  if (!value) return null
  const href = value.trim()
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : null
}

function sanitizeImageURL(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function sanitizeFileId(value: string | null) {
  if (!value || !/^[\w-]{1,200}$/.test(value)) return null
  return value
}

function sanitizeColumnWidths(value: string | null, colspan: number) {
  if (!value) return null
  const widths = value
    .split(",")
    .map((width) => normalizeInteger(width, 20, 2_000))
  return widths.length === colspan && widths.every(Boolean)
    ? widths.join(",")
    : null
}

function normalizeImageWidth(value: string | null) {
  const width = normalizeInteger(value, 20, 100) ?? 100
  return Math.round(width / 5) * 5
}

function normalizeInteger(value: string | null, min: number, max: number) {
  if (!value || !/^\d+$/.test(value)) return null
  const number = Number(value)
  return number >= min && number <= max ? number : null
}

function removeAttributes(element: Element) {
  for (const attribute of Array.from(element.attributes)) {
    element.removeAttribute(attribute.name)
  }
}

function hasBlockChildren(element: Element) {
  return Array.from(element.children).some((child) =>
    blockTags.has(child.tagName)
  )
}

function replaceTag(element: Element, tagName: string) {
  const replacement = element.ownerDocument.createElement(tagName)
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value)
  }
  replacement.append(...Array.from(element.childNodes))
  element.replaceWith(replacement)
  return replacement
}

function wrapChildren(element: Element, tagName: string) {
  const wrapper = element.ownerDocument.createElement(tagName)
  wrapper.append(...Array.from(element.childNodes))
  element.append(wrapper)
  return wrapper
}

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes))
}

function setHighlightAttributes(element: Element, color: string) {
  element.setAttribute("data-color", color)
  element.setAttribute("style", `background-color: ${color}; color: inherit`)
}
