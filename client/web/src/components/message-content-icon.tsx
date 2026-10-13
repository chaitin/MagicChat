import * as React from "react"
import Copy01Icon from "@hugeicons/core-free-icons/dist/esm/Copy01Icon"
import DocumentAttachmentIcon from "@hugeicons/core-free-icons/dist/esm/DocumentAttachmentIcon"
import Download01Icon from "@hugeicons/core-free-icons/dist/esm/Download01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/dist/esm/ExternalLinkIcon"
import Loading03Icon from "@hugeicons/core-free-icons/dist/esm/Loading03Icon"
import MessageMultiple02Icon from "@hugeicons/core-free-icons/dist/esm/MessageMultiple02Icon"
import PauseCircleIcon from "@hugeicons/core-free-icons/dist/esm/PauseCircleIcon"
import PlayCircle02Icon from "@hugeicons/core-free-icons/dist/esm/PlayCircle02Icon"
import Volume02Icon from "@hugeicons/core-free-icons/dist/esm/Volume02Icon"

const icons = {
  attachment: DocumentAttachmentIcon,
  copy: Copy01Icon,
  download: Download01Icon,
  loading: Loading03Icon,
  link: ExternalLinkIcon,
  forward: MessageMultiple02Icon,
  voice: Volume02Icon,
  play: PlayCircle02Icon,
  pause: PauseCircleIcon,
}

export function MessageContentIcon({ kind, strokeWidth = 2, ...props }: React.SVGProps<SVGSVGElement> & { kind: keyof typeof icons }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={24} height={24} fill="none" {...props}>
      {icons[kind].map(([tag, attributes]) => React.createElement(tag, {
        ...attributes,
        key: attributes.key,
        strokeWidth,
      }))}
    </svg>
  )
}
