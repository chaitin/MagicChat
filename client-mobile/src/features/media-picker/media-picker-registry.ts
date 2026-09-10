import type * as MediaLibrary from "expo-media-library/legacy"

export type MediaPickerRequest = {
  confirmLabel: string
  maxSelection?: number
  mediaKind?: "mixed" | "photo" | "video"
  mode: "single" | "multiple"
  onClose?: () => void
  onSelect: (assets: MediaLibrary.Asset[]) => void | Promise<void>
}

const requests = new Map<string, MediaPickerRequest>()

export function createMediaPickerRequest(request: MediaPickerRequest) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  requests.set(id, request)
  return id
}

export function getMediaPickerRequest(id: string) { return requests.get(id) }
export function deleteMediaPickerRequest(id: string) { requests.delete(id) }
