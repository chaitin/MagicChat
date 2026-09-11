export const voiceMessageAudioBitsPerSecond = 24_000
export const voiceMessageContentType = "audio/webm;codecs=opus"
export const voiceMessageMaxBytes = 1 * 1024 * 1024
export const voiceMessageMaxDurationMS = 60_000

export type VoiceMessageRecording = {
  blob: Blob
  durationMS: number
  transcript?: string
}
