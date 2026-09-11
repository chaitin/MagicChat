import * as React from "react"
import {
  Archive,
  File,
  FileCode2,
  FileImage,
  FileText,
  LoaderCircle,
  Table2,
} from "lucide-react"
import { toast } from "sonner"

import {
  readTemporaryFileURLs,
  type ClientFileMessageBody,
} from "@/lib/client-data-api"
import { formatFileSize } from "@/lib/file-format"

type MessageAttachmentProps = {
  file: ClientFileMessageBody
}

export function MessageAttachment({ file }: MessageAttachmentProps) {
  const [downloading, setDownloading] = React.useState(false)

  async function handleDownload(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (downloading) {
      return
    }

    setDownloading(true)

    try {
      const urls = await readTemporaryFileURLs([file.fileId])
      const readURL =
        urls.find((item) => item.fileId === file.fileId) ?? urls[0]

      if (!readURL) {
        throw new Error("missing read url")
      }

      triggerBrowserDownload(readURL.url, file.name)
    } catch {
      toast.error("下载文件失败")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="grid w-80 max-w-full gap-2">
      <button
        aria-label={`下载 ${file.name}`}
        className="group/attachment-row flex min-w-0 cursor-pointer items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
        disabled={downloading}
        onClick={handleDownload}
        title="下载"
        type="button"
      >
        {downloading ? (
          <LoaderCircle className="size-4.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <div className="shrink-0 text-muted-foreground">
            <AttachmentFileIcon fileName={file.name} />
          </div>
        )}
        <div className="min-w-0 flex-1 truncate text-sm transition-colors group-hover/attachment-row:text-(--weui-link)">
          {file.name}
        </div>
      </button>
      <div className="text-xs text-muted-foreground">
        {formatFileSize(file.sizeBytes)}
      </div>
    </div>
  )
}

function AttachmentFileIcon({ fileName }: { fileName: string }) {
  const extension = getFileExtension(fileName)

  if (imageExtensions.has(extension)) {
    return <FileImage className="size-4.5" />
  }
  if (spreadsheetExtensions.has(extension)) {
    return <Table2 className="size-4.5" />
  }
  if (archiveExtensions.has(extension)) {
    return <Archive className="size-4.5" />
  }
  if (codeExtensions.has(extension)) {
    return <FileCode2 className="size-4.5" />
  }
  if (textExtensions.has(extension)) {
    return <FileText className="size-4.5" />
  }

  return <File className="size-4.5" />
}

function getFileExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf(".")

  if (lastDotIndex < 0 || lastDotIndex === fileName.length - 1) {
    return ""
  }

  return fileName.slice(lastDotIndex + 1).toLowerCase()
}

function triggerBrowserDownload(url: string, fileName: string) {
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  link.rel = "noopener noreferrer"
  link.target = "_blank"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const imageExtensions = new Set([
  "apng",
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])
const spreadsheetExtensions = new Set(["csv", "numbers", "ods", "xls", "xlsx"])
const archiveExtensions = new Set(["7z", "gz", "rar", "tar", "tgz", "zip"])
const codeExtensions = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "php",
  "py",
  "rb",
  "rs",
  "sql",
  "swift",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
])
const textExtensions = new Set([
  "doc",
  "docx",
  "key",
  "md",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
])
