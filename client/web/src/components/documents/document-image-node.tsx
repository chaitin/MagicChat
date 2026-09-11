import * as React from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ImageIcon,
  Link2,
  Loader2,
  RotateCw,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { DocumentControlSeparator } from "@/components/documents/document-control-separator"
import { DocumentImageResolutionContext } from "@/components/documents/document-image-resolution"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { uploadDocumentImage } from "@/lib/document-image-api"
import { cn } from "@/lib/utils"

export function DocumentImageNodeView({
  node,
  updateAttributes,
}: NodeViewProps) {
  const { refresh, resolutions } = React.useContext(
    DocumentImageResolutionContext
  )
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const mountedRef = React.useRef(true)
  const fileId = typeof node.attrs.fileId === "string" ? node.attrs.fileId : ""
  const externalUrl =
    typeof node.attrs.externalUrl === "string" ? node.attrs.externalUrl : ""
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : ""
  const alignment = normalizeImageAlignment(node.attrs.alignment)
  const width = normalizeImageWidth(node.attrs.width)
  const resolution = fileId
    ? (resolutions.get(fileId) ?? { status: "loading" as const })
    : null
  const sourceUrl =
    externalUrl || (resolution?.status === "ready" ? resolution.url : "")
  const sourceKey = externalUrl ? `external:${externalUrl}` : `file:${fileId}`
  const [failureState, setFailureState] = React.useState({
    count: 0,
    sourceKey,
  })
  const [onlineURL, setOnlineURL] = React.useState("")
  const [showOnlineURL, setShowOnlineURL] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const loadFailures =
    failureState.sourceKey === sourceKey ? failureState.count : 0

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  function setLoadFailures(count: number) {
    setFailureState({ count, sourceKey })
  }

  function handleImageError() {
    if (externalUrl) {
      setLoadFailures(2)
      return
    }
    if (loadFailures === 0 && fileId) {
      setLoadFailures(1)
      refresh(fileId)
      return
    }
    setLoadFailures(2)
  }

  async function handleUpload(file: File | undefined) {
    if (!file || uploading) return
    setUploading(true)
    try {
      const uploaded = await uploadDocumentImage(file)
      if (!mountedRef.current) return
      updateAttributes({
        alt: file.name,
        externalUrl: null,
        fileId: uploaded.fileId,
      })
      setLoadFailures(0)
      setShowOnlineURL(false)
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error instanceof Error ? error.message : "上传图片失败")
      }
    } finally {
      if (mountedRef.current) setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function applyOnlineURL(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const url = normalizeOnlineImageURL(onlineURL)
      updateAttributes({
        alt: alt || "在线图片",
        externalUrl: url,
        fileId: null,
      })
      setLoadFailures(0)
      setOnlineURL("")
      setShowOnlineURL(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片地址格式错误")
    }
  }

  const imageReady = sourceUrl && loadFailures < 2
  const imageLoading = fileId && resolution?.status === "loading"

  return (
    <NodeViewWrapper className="document-image-node">
      <input
        accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => void handleUpload(event.target.files?.[0])}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <Popover>
        <PopoverTrigger asChild>
          <div
            aria-label="设置图片"
            className="document-image-node__body"
            role="button"
            tabIndex={0}
          >
            {imageReady ? (
              <img
                alt={alt}
                className="document-image-node__image"
                draggable={false}
                onError={handleImageError}
                onLoad={() => setLoadFailures(0)}
                src={sourceUrl}
                style={documentImageStyle(alignment, width)}
              />
            ) : imageLoading ? (
              <DocumentImagePlaceholder
                icon={<Loader2 className="animate-spin" />}
              >
                正在加载图片
              </DocumentImagePlaceholder>
            ) : (
              <DocumentImagePlaceholder
                icon={
                  uploading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ImageIcon />
                  )
                }
                message={
                  uploading
                    ? "正在上传图片"
                    : fileId || externalUrl
                      ? "图片已失效或加载失败"
                      : "添加一张图片"
                }
              >
                {fileId && !uploading && (
                  <Button
                    onClick={(event) => {
                      event.stopPropagation()
                      setLoadFailures(0)
                      refresh(fileId)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCw />
                    重新加载
                  </Button>
                )}
              </DocumentImagePlaceholder>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
        >
          <DocumentImageControls
            alignment={alignment}
            onlineURL={onlineURL}
            onAlignmentChange={(nextAlignment) =>
              updateAttributes({ alignment: nextAlignment })
            }
            onOnlineURLChange={setOnlineURL}
            onOnlineURLOpenChange={setShowOnlineURL}
            onOnlineURLSubmit={applyOnlineURL}
            onUpload={() => fileInputRef.current?.click()}
            onWidthChange={(nextWidth) =>
              updateAttributes({ width: nextWidth })
            }
            onlineURLOpen={showOnlineURL}
            uploading={uploading}
            width={width}
          />
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}

function DocumentImageControls({
  alignment,
  onlineURL,
  onlineURLOpen,
  onAlignmentChange,
  onOnlineURLChange,
  onOnlineURLOpenChange,
  onOnlineURLSubmit,
  onUpload,
  onWidthChange,
  uploading,
  width,
}: {
  alignment: DocumentImageAlignment
  onlineURL: string
  onlineURLOpen: boolean
  onAlignmentChange: (alignment: DocumentImageAlignment) => void
  onOnlineURLChange: (url: string) => void
  onOnlineURLOpenChange: (open: boolean) => void
  onOnlineURLSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onUpload: () => void
  onWidthChange: (width: number) => void
  uploading: boolean
  width: number
}) {
  const alignments = [
    { icon: AlignLeft, label: "左对齐", value: "left" },
    { icon: AlignCenter, label: "居中对齐", value: "center" },
    { icon: AlignRight, label: "右对齐", value: "right" },
  ] as const

  return (
    <div
      className="flex min-h-10 w-max flex-wrap items-center justify-between gap-3"
      contentEditable={false}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {alignments.map((item) => (
            <Button
              aria-label={item.label}
              aria-pressed={alignment === item.value}
              className={cn(alignment === item.value && "bg-muted")}
              key={item.value}
              onClick={() => onAlignmentChange(item.value)}
              size="icon-xs"
              title={item.label}
              type="button"
              variant="ghost"
            >
              <item.icon />
            </Button>
          ))}
        </div>
        <DocumentControlSeparator />
        <Slider
          aria-label="图片宽度"
          className="w-28"
          max={100}
          min={20}
          onValueChange={(value) => onWidthChange(value[0] ?? width)}
          step={5}
          value={[width]}
        />
        <span className="w-10 text-right text-xs text-muted-foreground">
          {width}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={uploading}
          onClick={onUpload}
          size="sm"
          type="button"
          variant="ghost"
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {uploading ? "正在上传" : "上传图片"}
        </Button>
        <Popover onOpenChange={onOnlineURLOpenChange} open={onlineURLOpen}>
          <PopoverTrigger asChild>
            <Button
              disabled={uploading}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Link2 />
              在线图片
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-3">
            <form
              className="flex items-center gap-2"
              onSubmit={onOnlineURLSubmit}
            >
              <Input
                aria-label="在线图片地址"
                autoFocus
                onChange={(event) => onOnlineURLChange(event.target.value)}
                placeholder="https://example.com/image.png"
                type="url"
                value={onlineURL}
              />
              <Button size="sm" type="submit">
                插入
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

function DocumentImagePlaceholder({
  children,
  icon,
  message,
}: {
  children?: React.ReactNode
  icon: React.ReactNode
  message?: string
}) {
  return (
    <div className="document-image-node__placeholder">
      <span className="document-image-node__placeholder-icon">{icon}</span>
      {message && <span>{message}</span>}
      {children}
    </div>
  )
}

type DocumentImageAlignment = "center" | "left" | "right"

function normalizeImageAlignment(value: unknown): DocumentImageAlignment {
  return value === "left" || value === "right" ? value : "center"
}

function normalizeImageWidth(value: unknown) {
  const width = typeof value === "number" ? value : Number(value)
  return Number.isFinite(width) ? Math.min(Math.max(width, 20), 100) : 100
}

function documentImageStyle(
  alignment: DocumentImageAlignment,
  width: number
): React.CSSProperties {
  return {
    marginLeft: alignment === "left" ? 0 : "auto",
    marginRight: alignment === "right" ? 0 : "auto",
    width: `${width}%`,
  }
}

function normalizeOnlineImageURL(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("图片地址必须使用 HTTP 或 HTTPS")
  }
  return url.toString()
}
