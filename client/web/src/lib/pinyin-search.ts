import { pinyin } from "pinyin-pro"

export function createPinyinSearchText(
  values: Array<string | null | undefined>
) {
  return createPinyinSearchTokens(values).join(" ")
}

export function createPinyinSearchTokens(
  values: Array<string | null | undefined>
) {
  const tokens = new Set<string>()

  for (const value of values) {
    addSearchToken(tokens, value)
  }

  return Array.from(tokens)
}

export function normalizePinyinSearchQuery(value: string) {
  return normalizeSearchToken(value)
}

function addSearchToken(tokens: Set<string>, value: string | null | undefined) {
  const normalizedValue = normalizeSearchToken(value ?? "")
  if (!normalizedValue) {
    return
  }

  tokens.add(normalizedValue)

  const rawValue = value?.trim() ?? ""
  if (!hasChineseCharacter(rawValue)) {
    return
  }

  const fullPinyin = pinyin(rawValue, {
    toneType: "none",
    type: "array",
  })

  addPinyinToken(tokens, fullPinyin.join(""))
  addPinyinToken(tokens, fullPinyin.join(" "), true)
  addPinyinToken(
    tokens,
    pinyin(rawValue, {
      pattern: "first",
      toneType: "none",
      type: "array",
    }).join("")
  )
}

function addPinyinToken(
  tokens: Set<string>,
  value: string,
  preserveSpaces = false
) {
  const normalizedValue = preserveSpaces
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : normalizeSearchToken(value)
  if (!normalizedValue) {
    return
  }

  tokens.add(normalizedValue)

  if (normalizedValue.includes("ü")) {
    tokens.add(normalizedValue.replaceAll("ü", "v"))
    tokens.add(normalizedValue.replaceAll("ü", "u"))
  }
}

function normalizeSearchToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function hasChineseCharacter(value: string) {
  return /[\u3400-\u9fff]/.test(value)
}
