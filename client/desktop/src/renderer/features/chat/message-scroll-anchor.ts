type MessageAnchor = { id: string; top: number }

export type MessageScrollSnapshot = {
  anchor: MessageAnchor | null
  scrollHeight: number
  scrollTop: number
}

export function captureMessageScroll(viewport: HTMLElement): MessageScrollSnapshot {
  const bounds = viewport.getBoundingClientRect()
  const row = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
    (element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    },
  )
  return {
    anchor: row?.dataset.messageId
      ? { id: row.dataset.messageId, top: row.getBoundingClientRect().top - bounds.top }
      : null,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop,
  }
}

export function restoreMessageScroll(viewport: HTMLElement, snapshot: MessageScrollSnapshot) {
  const row = snapshot.anchor
    ? Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (element) => element.dataset.messageId === snapshot.anchor?.id,
      )
    : null
  if (row && snapshot.anchor) {
    viewport.scrollTop +=
      row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - snapshot.anchor.top
  } else {
    viewport.scrollTop = snapshot.scrollTop + viewport.scrollHeight - snapshot.scrollHeight
  }
}
