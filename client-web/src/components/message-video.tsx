import * as React from "react"
import { VideoOff } from "lucide-react"

import {
  readTemporaryFileURLs,
  type ClientVideoMessageBody,
} from "@/lib/client-data-api"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function MessageVideo({
  roundedBottom = true,
  video,
}: {
  roundedBottom?: boolean
  video: ClientVideoMessageBody
}) {
  const [playbackErrorURL, setPlaybackErrorURL] = React.useState("")
  const [source, setSource] = React.useState<{
    error: boolean
    fileId: string
    url: string | null
  } | null>(null)

  React.useEffect(() => {
    if (video.localURL) return
    let active = true
    readTemporaryFileURLs([video.fileId])
      .then((urls) => {
        if (!active) return
        const value =
          urls.find((item) => item.fileId === video.fileId) ?? urls[0]
        if (!value) throw new Error("missing read url")
        setSource({ error: false, fileId: video.fileId, url: value.url })
      })
      .catch(() => {
        if (active) {
          setSource({ error: true, fileId: video.fileId, url: null })
        }
      })
    return () => {
      active = false
    }
  }, [video.fileId, video.localURL])

  const current = video.localURL
    ? { error: false, fileId: video.fileId, url: video.localURL }
    : source?.fileId === video.fileId
      ? source
      : null
  if (current?.error || (current?.url && playbackErrorURL === current.url)) {
    return (
      <div
        className={cn(
          "flex aspect-video w-80 max-w-[65vw] items-center justify-center gap-2 rounded-sm bg-muted text-sm text-muted-foreground",
          !roundedBottom && "rounded-b-none"
        )}
      >
        <VideoOff className="size-5" />
        视频加载失败
      </div>
    )
  }
  if (!current?.url) {
    return (
      <Skeleton
        className={cn(
          "aspect-video w-80 max-w-[65vw] rounded-sm",
          !roundedBottom && "rounded-b-none"
        )}
      />
    )
  }
  return (
    <video
      className={cn(
        "aspect-video w-80 max-w-[65vw] rounded-sm bg-black object-contain",
        !roundedBottom && "rounded-b-none"
      )}
      controls
      onError={() => setPlaybackErrorURL(current.url ?? "")}
      playsInline
      preload="metadata"
      src={current.url}
    />
  )
}
