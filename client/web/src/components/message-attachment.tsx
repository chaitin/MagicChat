import * as React from "react"
import { toast } from "sonner"

import {
  readTemporaryFileURLs,
  type ClientFileMessageBody,
} from "@/lib/client-data-api"
import { formatFileSize } from "@/lib/file-format"
import { MessageContentIcon } from "@/components/message-content-icon"
import { Button } from "@/components/ui/button"

type MessageAttachmentProps = {
  file: ClientFileMessageBody
}

export function MessageAttachment({ file }: MessageAttachmentProps) {
  const [preparing, setPreparing] = React.useState(false)

  async function handleDownload(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (preparing) return
    setPreparing(true)
    try {
      const urls = await readTemporaryFileURLs([file.fileId])
      const readURL = urls.find((item) => item.fileId === file.fileId) ?? urls[0]
      if (!readURL) throw new Error("missing read url")
      triggerBrowserDownload(readURL.url, file.name)
    } catch {
      toast.error("下载文件失败")
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="relative flex w-80 max-w-full items-center gap-3 overflow-hidden text-left">
      <MessageContentIcon kind="attachment" className="size-7 shrink-0 text-foreground" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="truncate leading-6">{file.name}</div>
        <div className="text-xs text-muted-foreground">
          {preparing ? "准备下载" : formatFileSize(file.sizeBytes)}
        </div>
      </div>
      <Button
        aria-label={preparing ? `正在准备下载 ${file.name}` : `下载 ${file.name}`}
        aria-busy={preparing}
        className="shrink-0 hover:bg-foreground/5 active:bg-foreground/5 dark:hover:bg-foreground/5"
        disabled={preparing}
        onClick={handleDownload}
        size="icon-sm"
        title={preparing ? "正在准备下载" : "下载文件"}
        type="button"
        variant="ghost"
      >
        <MessageContentIcon kind={preparing ? "loading" : "download"} className={`size-4 group-hover/message-bubble:text-xgui-brand-5${preparing ? " animate-spin" : ""}`} />
      </Button>
    </div>
  )
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
