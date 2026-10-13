import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import DocumentAttachmentIcon from "@hugeicons/core-free-icons/dist/esm/DocumentAttachmentIcon"
import Download01Icon from "@hugeicons/core-free-icons/dist/esm/Download01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/dist/esm/ExternalLinkIcon"
import Loading03Icon from "@hugeicons/core-free-icons/dist/esm/Loading03Icon"
import MessageMultiple02Icon from "@hugeicons/core-free-icons/dist/esm/MessageMultiple02Icon"
import PauseCircleIcon from "@hugeicons/core-free-icons/dist/esm/PauseCircleIcon"
import PlayCircle02Icon from "@hugeicons/core-free-icons/dist/esm/PlayCircle02Icon"
import Volume02Icon from "@hugeicons/core-free-icons/dist/esm/Volume02Icon"

import { MessageContentIcon } from "./message-content-icon"

const cases = [
  ["attachment", DocumentAttachmentIcon], ["download", Download01Icon],
  ["link", ExternalLinkIcon], ["loading", Loading03Icon],
  ["forward", MessageMultiple02Icon], ["voice", Volume02Icon],
  ["play", PlayCircle02Icon], ["pause", PauseCircleIcon],
] as const

describe("Desktop message icons", () => {
  it.each(cases)("renders %s with the original paths/circles and requested stroke", (kind, data) => {
    const { container } = render(<MessageContentIcon kind={kind} strokeWidth={1.5} className="size-7" />)
    const svg = container.querySelector("svg")!
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg.children).toHaveLength(data.length)
    data.forEach(([tag, attrs], index) => {
      const node = svg.children[index]
      expect(node.tagName.toLowerCase()).toBe(tag)
      expect(node).toHaveAttribute("stroke-width", "1.5")
      for (const key of ["d", "cx", "cy", "r", "fill", "stroke"]) {
        if (attrs[key]) expect(node).toHaveAttribute(key, attrs[key])
      }
    })
  })
})
