import { pinyin } from "pinyin-pro"

export type UserSearchFields = {
  name: string
  nickname: string
  email: string
  phone: string
  displayName?: string
}
export type UserSearchIndex = { text: string[]; phonetic: string[]; phone: string }

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
}

export function createUserSearchIndex(fields: UserSearchFields): UserSearchIndex {
  const names = [
    ...new Set(
      [fields.name, fields.nickname, fields.displayName ?? ""].map(normalize).filter(Boolean),
    ),
  ]
  return {
    text: [...names, normalize(fields.email), normalize(fields.phone)].filter(Boolean),
    phonetic: names.flatMap((name) => [
      pinyin(name, { type: "array", toneType: "none" }).join("").replace(/\s+/g, "").toLowerCase(),
      pinyin(name, { pattern: "first", type: "array", toneType: "none" })
        .join("")
        .replace(/\s+/g, "")
        .toLowerCase(),
    ]),
    phone: normalize(fields.phone).replace(/\D/g, ""),
  }
}

export function matchesUserSearch(index: UserSearchIndex, input: string): boolean {
  const query = normalize(input)
  if (!query) return true
  if (index.text.some((text) => text.includes(query))) return true
  const phoneticQuery = query.replace(/[\s']/g, "")
  if (phoneticQuery && index.phonetic.some((text) => text.includes(phoneticQuery))) return true
  if (/^[+\d\s().-]+$/.test(query)) {
    const digits = query.replace(/\D/g, "")
    return Boolean(digits && index.phone.includes(digits))
  }
  return false
}
