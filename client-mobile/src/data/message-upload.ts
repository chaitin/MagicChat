export type ClientMessageUpload = {
  mimeType: string
  name: string
  sizeBytes: number
  uri: string
}

export type PreparedClientMessageUpload = {
  cleanup?: () => void
  height?: number
  kind: "file" | "image"
  upload: ClientMessageUpload
  width?: number
}

export type PreparedClientVoiceMessage = {
  cleanup: () => void
  durationMS: number
  upload: ClientMessageUpload
}
