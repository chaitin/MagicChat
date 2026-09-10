export type ClientMessageUpload = {
  mimeType: string
  name: string
  sizeBytes: number
  uri: string
}

export type PreparedClientMessageUpload = {
  cleanup?: () => void
  height?: number
  kind: "file" | "image" | "video"
  upload: ClientMessageUpload
  width?: number
}

export type PreparedClientVoiceMessage = {
  cleanup: () => void
  durationMS: number
  transcript?: string
  upload: ClientMessageUpload
}

export function createVoiceMessageExtraFields(
  durationMS: number,
  transcript?: string
) {
  const normalizedTranscript = transcript?.trim()
  return {
    duration_ms: String(durationMS),
    ...(normalizedTranscript ? { transcript: normalizedTranscript } : {}),
  }
}
