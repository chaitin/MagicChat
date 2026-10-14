import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react"
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Strikethrough,
  Table2,
  X,
} from "lucide-react"
import type { ProjectTaskImageContextInput } from "../../../shared/account-data"
import {
  insertTaskImages,
  removeTaskImageUpload,
  replaceTaskImageUpload,
  taskImageMarkdown,
  taskImageSelectionAfterUpload,
  taskImageUploadSource,
  taskImageValidationError,
} from "../../../shared/task-image"
import { MessageMarkdown } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { TaskTextContextMenu } from "./task-text-context-menu"

type ImageUpload = {
  id: string
  file: File
  status: "queued" | "uploading" | "failed"
  error: string
}
const noMentionLabel = () => undefined

export function TaskDescriptionEditor({
  targetId,
  projectId,
  taskId,
  value,
  disabled,
  onChange,
}: ProjectTaskImageContextInput & {
  value: string
  disabled: boolean
  onChange: (update: (current: string) => string) => void
}) {
  const id = useId()
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState("")
  const [uploads, setUploads] = useState<ImageUpload[]>([])
  const uploadsRef = useRef(new Map<string, ImageUpload>())
  const uploadQueue = useRef(Promise.resolve())
  const textarea = useRef<HTMLTextAreaElement>(null)
  const active = useRef(true)
  const selection = useRef<{ text: string; start: number; end: number } | null>(null)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useLayoutEffect(() => {
    const pending = selection.current
    selection.current = null
    if (pending && pending.text === value && document.activeElement === textarea.current) {
      textarea.current?.setSelectionRange(pending.start, pending.end)
    }
  }, [value])

  useEffect(() => {
    let removed = false
    for (const upload of uploadsRef.current.values()) {
      if (!value.includes(`](${taskImageUploadSource(upload.id)})`)) {
        uploadsRef.current.delete(upload.id)
        removed = true
      }
    }
    if (removed) setUploads([...uploadsRef.current.values()])
  }, [value])

  function changeUpload(upload: ImageUpload) {
    uploadsRef.current.set(upload.id, upload)
    setUploads([...uploadsRef.current.values()])
  }

  async function uploadImage(id: string) {
    const upload = uploadsRef.current.get(id)
    if (!active.current || !upload || upload.status !== "queued") return
    changeUpload({ ...upload, status: "uploading" })
    try {
      const bytes = await upload.file.arrayBuffer()
      if (!active.current || !uploadsRef.current.has(id)) return
      const result = await window.taskWindow!.accountData.uploadProjectTaskImage({
        targetId,
        projectId,
        ...(taskId ? { taskId } : {}),
        bytes,
        name: upload.file.name,
        contentType: upload.file.type,
      })
      if (!active.current || !uploadsRef.current.has(id)) return
      if (!result.ok) throw new Error(result.error.message)
      const input = textarea.current
      if (input && document.activeElement === input) {
        selection.current = taskImageSelectionAfterUpload(
          input.value,
          id,
          result.data.fileId,
          input.selectionStart,
          input.selectionEnd,
        )
      }
      onChange((current) => replaceTaskImageUpload(current, id, result.data.fileId))
      uploadsRef.current.delete(id)
    } catch (reason) {
      if (active.current && uploadsRef.current.has(id)) {
        changeUpload({
          ...upload,
          status: "failed",
          error: reason instanceof Error ? reason.message : "图片上传失败",
        })
      }
    } finally {
      if (active.current) setUploads([...uploadsRef.current.values()])
    }
  }

  function enqueue(id: string) {
    uploadQueue.current = uploadQueue.current.then(() => uploadImage(id))
  }

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return
    const files: File[] = []
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (!files.length)
      files.push(
        ...Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")),
      )
    if (!files.length) return
    event.preventDefault()
    setError("")
    if (files.length + uploadsRef.current.size > 10) return setError("最多同时上传 10 张图片")
    for (const file of files) {
      const error = taskImageValidationError(file)
      if (error) return setError(error)
    }
    const added: ImageUpload[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      error: "",
    }))
    const input = event.currentTarget
    const start = input.selectionStart
    const end = input.selectionEnd
    const markdown = added.map((upload) =>
      taskImageMarkdown(upload.file.name, taskImageUploadSource(upload.id)),
    )
    const inserted = insertTaskImages(input.value, start, end, markdown)
    if (inserted.text.length > 10000) return setError("详细说明不能超过 10000 个字符")
    selection.current = { text: inserted.text, start: inserted.caret, end: inserted.caret }
    for (const upload of added) uploadsRef.current.set(upload.id, upload)
    setUploads([...uploadsRef.current.values()])
    onChange((current) => insertTaskImages(current, start, end, markdown).text)
    for (const upload of added) enqueue(upload.id)
  }

  function removeImage(upload: ImageUpload) {
    uploadsRef.current.delete(upload.id)
    setUploads([...uploadsRef.current.values()])
    onChange((current) => removeTaskImageUpload(current, upload.id))
  }

  function applyMarkdown(prefix: string, suffix = prefix, placeholder = "文本") {
    const input = textarea.current
    if (disabled || preview || !input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = input.value.slice(start, end)
    const content = selected || placeholder
    const next = `${input.value.slice(0, start)}${prefix}${content}${suffix}${input.value.slice(end)}`
    const nextStart = start + prefix.length
    const nextEnd = nextStart + content.length
    selection.current = { text: next, start: nextStart, end: nextEnd }
    onChange(() => next)
  }

  function insertMarkdown(text: string, selectionOffset = text.length) {
    const input = textarea.current
    if (disabled || preview || !input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
    selection.current = {
      text: next,
      start: start + selectionOffset,
      end: start + selectionOffset,
    }
    onChange(() => next)
  }

  function applyLinePrefix(prefix: string) {
    const input = textarea.current
    if (disabled || preview || !input) return
    const start = input.selectionStart
    const end = input.selectionEnd
    const lineStart = input.value.lastIndexOf("\n", start - 1) + 1
    const selected = input.value.slice(lineStart, end)
    const next = `${input.value.slice(0, lineStart)}${selected
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
      .join("\n")}${input.value.slice(end)}`
    selection.current = {
      text: next,
      start: start + prefix.length,
      end: end + prefix.length * selected.split("\n").length,
    }
    onChange(() => next)
  }

  const toolbarButton = (label: string, icon: ReactNode, action: () => void) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={label}
      title={label}
      disabled={disabled || preview}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </Button>
  )

  const renderAttachment = useCallback(
    (fileId: string, alt: string) => (
      <TaskAttachmentImage
        targetId={targetId}
        projectId={projectId}
        taskId={taskId}
        fileId={fileId}
        alt={alt}
      />
    ),
    [targetId, projectId, taskId],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-col text-sm">
      <label htmlFor={id} className="mb-1 text-xs text-muted-foreground">
        详细说明
      </label>
      <div
        className="flex min-h-9 items-center justify-between gap-2 rounded-t-md rounded-b-none border border-input border-b-0 bg-transparent px-1.5 py-1 shadow-xs dark:bg-input/30"
        aria-label="详细说明工具栏"
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          aria-label="Markdown辅助工具"
        >
          {toolbarButton("加粗", <Bold className="size-4" />, () => applyMarkdown("**"))}
          {toolbarButton("斜体", <Italic className="size-4" />, () => applyMarkdown("*"))}
          {toolbarButton("删除线", <Strikethrough className="size-4" />, () => applyMarkdown("~~"))}
          {toolbarButton("标题", <Heading2 className="size-4" />, () => applyLinePrefix("## "))}
          {toolbarButton("引用", <Quote className="size-4" />, () => applyLinePrefix("> "))}
          {toolbarButton("无序列表", <List className="size-4" />, () => applyLinePrefix("- "))}
          {toolbarButton("有序列表", <ListOrdered className="size-4" />, () =>
            applyLinePrefix("1. "),
          )}
          {toolbarButton("行内代码", <Code2 className="size-4" />, () => applyMarkdown("`"))}
          {toolbarButton("插入链接", <Link2 className="size-4" />, () =>
            applyMarkdown("[", "](https://)", "链接文本"),
          )}
          {toolbarButton("插入表格", <Table2 className="size-4" />, () =>
            insertMarkdown("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |"),
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" aria-label="说明显示模式">
          <Button
            type="button"
            variant={preview ? "ghost" : "secondary"}
            size="sm"
            className="h-6 px-2 text-xs"
            aria-pressed={!preview}
            disabled={disabled}
            onClick={() => setPreview(false)}
          >
            原文
          </Button>
          <Button
            type="button"
            variant={preview ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            aria-pressed={preview}
            disabled={disabled}
            onClick={() => setPreview(true)}
          >
            预览
          </Button>
        </div>
      </div>
      {preview ? (
        <TaskTextContextMenu>
          <div
            role="region"
            aria-label="详细说明预览"
            className="min-h-24 flex-1 overflow-auto rounded-t-none rounded-b-md border border-input p-3 select-text"
          >
            {value ? (
              <MessageMarkdown
                content={value}
                currentUserId=""
                mentionLabelResolver={noMentionLabel}
                renderAttachmentImage={renderAttachment}
              />
            ) : (
              <p className="text-muted-foreground">暂无详细说明</p>
            )}
          </div>
        </TaskTextContextMenu>
      ) : (
        <TaskTextContextMenu editable disabled={disabled}>
          <Textarea
            id={id}
            ref={textarea}
            className="min-h-24 flex-1 resize-none rounded-t-none field-sizing-fixed font-mono"
            placeholder="支持 markdown 语法，可直接粘贴图片"
            value={value}
            maxLength={10000}
            disabled={disabled}
            onPaste={pasteImages}
            onChange={(event) => {
              const next = event.target.value
              onChange(() => next)
            }}
          />
        </TaskTextContextMenu>
      )}
      {(error || uploads.length > 0) && (
        <div
          className="mt-1 grid max-h-28 shrink-0 gap-1 overflow-y-auto pt-1 text-xs"
          aria-live="polite"
        >
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {uploads.map((upload) => (
            <div key={upload.id} className="flex min-w-0 items-center gap-2">
              {upload.status !== "failed" && <Loader2 className="size-3 shrink-0 animate-spin" />}
              <span
                className={
                  upload.status === "failed"
                    ? "min-w-0 truncate text-destructive"
                    : "min-w-0 truncate text-muted-foreground"
                }
                title={upload.error || upload.file.name}
              >
                {upload.file.name || "粘贴图片"}：
                {upload.status === "failed"
                  ? upload.error
                  : upload.status === "queued"
                    ? "等待上传…"
                    : "上传中…"}
              </span>
              {upload.status === "failed" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={disabled}
                  onClick={() => {
                    changeUpload({ ...upload, status: "queued", error: "" })
                    enqueue(upload.id)
                  }}
                >
                  重试
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-6 shrink-0"
                aria-label={`移除图片 ${upload.file.name || "粘贴图片"}`}
                disabled={disabled}
                onClick={() => removeImage(upload)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskAttachmentImage({
  targetId,
  projectId,
  taskId,
  fileId,
  alt,
}: ProjectTaskImageContextInput & { fileId: string; alt: string }) {
  const [url, setURL] = useState("")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setURL("")
    setError("")
    void window
      .taskWindow!.accountData.readProjectTaskImage({
        targetId,
        projectId,
        ...(taskId ? { taskId } : {}),
        fileId,
      })
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        setURL(result.data.url)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "图片加载失败")
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, taskId, fileId, attempt])
  if (error)
    return (
      <span className="inline-flex items-center gap-2 text-xs text-destructive">
        {alt || "图片"}：{error}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAttempt((value) => value + 1)}
        >
          重试
        </Button>
      </span>
    )
  return url ? (
    <img
      alt={alt}
      src={url}
      className="my-1 block h-auto max-h-80 max-w-full rounded-md object-contain"
      loading="lazy"
      decoding="async"
      onError={() => setError("图片加载失败或已过期")}
    />
  ) : (
    <span className="text-xs text-muted-foreground">图片加载中…</span>
  )
}
