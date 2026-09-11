export type MessageTextLinkPart = {
  href: string
  type: "link"
  value: string
}

export type MessageTextPart =
  | MessageTextLinkPart
  | {
      type: "text"
      value: string
    }

const hostnameLabel = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?`
const pathCharacter = String.raw`[A-Za-z0-9._~%!$&'()*+,;=:@/-]`
const queryOrHashCharacter = String.raw`[A-Za-z0-9._~%!$&'()*+,;=:@/?-]`
const supportedURLPattern = new RegExp(
  String.raw`^https?:\/\/${hostnameLabel}(?:\.${hostnameLabel})*(?::\d{1,5})?(?:\/${pathCharacter}*)?(?:\?${queryOrHashCharacter}*)?(?:#${queryOrHashCharacter}*)?$`,
  "i"
)
const urlCandidatePattern =
  /https?:\/\/[A-Za-z0-9._~%!$&'()*+,;=:@/?#-]+/gi
const trailingSentencePunctuationPattern = /[.,!?;:'\]}]+$/

export function linkifyMessageText(value: string): MessageTextPart[] {
  const parts: MessageTextPart[] = []
  let textStart = 0

  for (const match of value.matchAll(urlCandidatePattern)) {
    const matchStart = match.index
    const url = trimTrailingSentencePunctuation(match[0])

    if (!isSupportedMessageURL(url)) {
      continue
    }

    if (matchStart > textStart) {
      parts.push({ type: "text", value: value.slice(textStart, matchStart) })
    }

    parts.push({ href: url, type: "link", value: url })
    textStart = matchStart + url.length
  }

  if (textStart < value.length || parts.length === 0) {
    parts.push({ type: "text", value: value.slice(textStart) })
  }

  return parts
}

function trimTrailingSentencePunctuation(value: string) {
  let trimmedValue = value.replace(trailingSentencePunctuationPattern, "")

  while (
    trimmedValue.endsWith(")") &&
    countCharacter(trimmedValue, ")") > countCharacter(trimmedValue, "(")
  ) {
    trimmedValue = trimmedValue.slice(0, -1)
  }

  return trimmedValue
}

function countCharacter(value: string, character: string) {
  let count = 0

  for (const currentCharacter of value) {
    if (currentCharacter === character) {
      count += 1
    }
  }

  return count
}

function isSupportedMessageURL(value: string) {
  if (!supportedURLPattern.test(value)) {
    return false
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname.length > 253
    ) {
      return false
    }

    const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0]
    const portSeparatorIndex = authority.lastIndexOf(":")

    if (portSeparatorIndex >= 0) {
      const port = Number(authority.slice(portSeparatorIndex + 1))
      if (port < 1 || port > 65_535) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}
