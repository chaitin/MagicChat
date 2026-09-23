import type { DesktopMessage } from "./account-data"

export const MESSAGE_PAGE_SIZE = 20

export function contiguousMessageSuffix(messages: DesktopMessage[]) {
  if (messages.length < 2) return messages
  let start = messages.length - 1
  while (start > 0 && messages[start - 1].seq + 1 === messages[start].seq) start -= 1
  return messages.slice(start)
}

export function isCompleteLocalPage(messages: DesktopMessage[], beforeSeq: number) {
  if (messages.length === 0 || messages.at(-1)?.seq !== beforeSeq - 1) return false
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index - 1].seq + 1 !== messages[index].seq) return false
  }
  return messages.length === MESSAGE_PAGE_SIZE || messages[0].seq === 1
}
