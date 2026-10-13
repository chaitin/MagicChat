import type { ClientForwardBundleMessageBody } from "@/core/models"
import type { PresentedMessage } from "@/domain/messages/message-presenter"

let nextRecordId = 0

export function createChatRecordStore(scopeKey: string) {
  const records = new Map<string, { body: ClientForwardBundleMessageBody; readers: number }>()
  return {
    scopeKey,
    add(body: ClientForwardBundleMessageBody) {
      const id = `record-${++nextRecordId}`
      records.set(id, { body: JSON.parse(JSON.stringify(body)) as ClientForwardBundleMessageBody, readers: 0 })
      return id
    },
    get(id: string) { return records.get(id)?.body ?? null },
    remove(id: string) { records.delete(id) },
    retain(id: string) {
      const record = records.get(id)
      if (!record) return () => {}
      record.readers += 1
      let released = false
      return () => {
        if (released) return
        released = true
        record.readers -= 1
        // StrictMode may immediately retain the same screen again after cleanup.
        queueMicrotask(() => {
          if (record.readers === 0 && records.get(id) === record) records.delete(id)
        })
      }
    },
  }
}

export type ChatRecordStore = ReturnType<typeof createChatRecordStore>

export function presentChatRecordMessages(body: ClientForwardBundleMessageBody, recordId: string) {
  return body.items.map((item, index) => ({
    senderType: item.senderType,
    message: {
      author: item.senderName,
      avatar: "",
      body: item.body,
      canRevoke: false,
      createdAt: item.sentAt,
      delegatedByName: "",
      id: `${recordId}:${index}`,
      reactions: [],
      role: "other",
      sender: null,
    } satisfies PresentedMessage,
  }))
}
