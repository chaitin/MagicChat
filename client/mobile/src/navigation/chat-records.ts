import type { Href } from "expo-router"

export function buildChatRecordHref(recordId: string): Href {
  return { pathname: "/chat-records/[recordId]", params: { recordId } } as unknown as Href
}
