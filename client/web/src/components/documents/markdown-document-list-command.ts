export type MarkdownListType = "bullet" | "ordered" | "task"

export function transformMarkdownList(
  source: string,
  listType: MarkdownListType
) {
  const lines = source.split("\n")
  const nonEmptyLines = lines.filter((line) => line.trim())
  const removeList =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => markdownLineHasListType(line, listType))
  const allLinesEmpty = nonEmptyLines.length === 0
  let orderedIndex = 0

  return lines
    .map((line, lineIndex) => {
      const indentation = line.match(/^\s*/)?.[0] ?? ""
      if (!line.trim()) {
        if (!allLinesEmpty || lineIndex > 0) return line
        orderedIndex += 1
        return `${indentation}${markdownListPrefix(listType, orderedIndex)}`
      }

      const content = stripMarkdownListPrefix(line.slice(indentation.length))
      if (removeList) return `${indentation}${content}`
      orderedIndex += 1
      return `${indentation}${markdownListPrefix(listType, orderedIndex)}${content}`
    })
    .join("\n")
}

function markdownListPrefix(listType: MarkdownListType, orderedIndex: number) {
  if (listType === "bullet") return "- "
  if (listType === "task") return "- [ ] "
  return `${orderedIndex}. `
}

function markdownLineHasListType(line: string, listType: MarkdownListType) {
  const content = line.trimStart()
  if (listType === "task") return /^[-+*]\s+\[[ xX]\]\s+/.test(content)
  if (listType === "ordered") return /^\d+[.)]\s+/.test(content)
  return /^[-+*]\s+(?!\[[ xX]\]\s+)/.test(content)
}

function stripMarkdownListPrefix(line: string) {
  return line.replace(/^(?:[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+)/, "")
}
