import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageAttachment } from "./message-attachment"

describe("MessageAttachment", () => {
  it("renders the file size on a separate row", () => {
    const { container } = render(
      <MessageAttachment
        file={{
          fileId: "file-1",
          name: "项目说明.pdf",
          sizeBytes: 1024,
          type: "file",
        }}
      />
    )

    const attachment = container.firstElementChild
    expect(attachment).toHaveClass("grid", "w-80")
    expect(screen.getByText("项目说明.pdf").parentElement).toHaveClass("flex")
    expect(screen.getByText("1 KB").parentElement).toBe(attachment)
  })
})
