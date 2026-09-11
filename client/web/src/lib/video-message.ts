export const videoMessageMaxBytes = 100 * 1024 * 1024

const acceptedVideoTypes = new Set(["video/mp4", "video/webm"])
const acceptedVideoExtensions = [".mp4", ".webm"]

export function getVideoMessageUploadError(video: File) {
  if (video.size <= 0) {
    return "视频不能为空"
  }
  if (video.size > videoMessageMaxBytes) {
    return "视频大于 100MiB，无法上传"
  }
  if (!isAcceptedVideoMessageFile(video)) {
    return "视频必须是 MP4 或 WebM 格式"
  }
  return null
}

export function isAcceptedVideoMessageFile(video: File) {
  if (acceptedVideoTypes.has(video.type.toLowerCase())) {
    return true
  }
  const name = video.name.toLowerCase()
  return acceptedVideoExtensions.some((extension) => name.endsWith(extension))
}
