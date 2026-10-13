import { markdownAttachmentSource } from "../../../shared/markdown-attachment.ts"

export const MAX_TASK_IMAGE_BYTES = 10 * 1024 * 1024
export const TASK_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
])

export function taskImageValidationError(file: { type: string; size: number }): string | null {
  if (!TASK_IMAGE_CONTENT_TYPES.has(file.type)) return "请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片"
  if (file.size <= 0) return "图片内容为空"
  if (file.size > MAX_TASK_IMAGE_BYTES) return "图片不能超过 10MiB"
  return null
}

export function taskImageUploadSource(id: string): string {
  return `task-upload:${id}`
}

export function taskImageMarkdown(name: string, source: string): string {
  const label = (name || "粘贴图片")
    .slice(0, 120)
    .replace(/[\r\n]/g, " ")
    .replace(/[\\[\]]/g, "\\$&")
  return `![${label}](${source})`
}

export function insertTaskImages(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  markdown: string[],
): { text: string; caret: number } {
  const before = text.slice(0, selectionStart)
  const after = text.slice(selectionEnd)
  const inserted = `${before && !before.endsWith("\n") ? "\n" : ""}${markdown.join("\n")}\n`
  return { text: before + inserted + after, caret: before.length + inserted.length }
}

export function hasTaskImageUpload(text: string): boolean {
  return /\]\(task-upload:[A-Za-z0-9-]+\)/.test(text)
}

export function replaceTaskImageUpload(text: string, id: string, fileId: string): string {
  // 仅替换占位目标，保留上传期间的编辑；用户已删除占位时不补回图片。
  return text.replaceAll(
    `](${taskImageUploadSource(id)})`,
    `](${markdownAttachmentSource(fileId)})`,
  )
}

export function taskImageSelectionAfterUpload(
  text: string,
  id: string,
  fileId: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const before = `](${taskImageUploadSource(id)})`
  const after = `](${markdownAttachmentSource(fileId)})`
  function translate(position: number): number {
    let offset = 0
    let delta = 0
    for (;;) {
      const index = text.indexOf(before, offset)
      if (index < 0 || position <= index) return position + delta
      if (position < index + before.length) return index + delta + after.length
      delta += after.length - before.length
      offset = index + before.length
    }
  }
  return {
    text: replaceTaskImageUpload(text, id, fileId),
    start: translate(start),
    end: translate(end),
  }
}

export function removeTaskImageUpload(text: string, id: string): string {
  const source = taskImageUploadSource(id)
  return text.replace(/!\[(?:\\.|[^\]\\])*\]\(task-upload:[A-Za-z0-9-]+\)/g, (image) =>
    image.endsWith(`](${source})`) ? "" : image,
  )
}
