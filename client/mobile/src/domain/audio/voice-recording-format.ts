export type VoiceRecordingFormat = {
  extension: ".m4a" | ".webm"
  mimeType: "audio/mp4" | "audio/webm"
}

export function getVoiceRecordingFormat(platformOS: string): VoiceRecordingFormat {
  return platformOS === "web"
    ? { extension: ".webm", mimeType: "audio/webm" }
    : { extension: ".m4a", mimeType: "audio/mp4" }
}
