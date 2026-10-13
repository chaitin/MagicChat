export type EmojiTextRun = { text: string; emoji: boolean }

// Keep modifiers, variation selectors, flags, keycaps and ZWJ sequences together.
const emojiSequence = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)/gu

export function splitEmojiText(text: string): EmojiTextRun[] {
  const runs: EmojiTextRun[] = []
  let offset = 0
  for (const match of text.matchAll(emojiSequence)) {
    if (match.index > offset) runs.push({ text: text.slice(offset, match.index), emoji: false })
    runs.push({ text: match[0], emoji: !match[0].includes("\uFE0E") })
    offset = match.index + match[0].length
  }
  if (offset < text.length) runs.push({ text: text.slice(offset), emoji: false })
  return runs
}
