import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SendFileMessageDialog } from "@/components/send-file-message-dialog"
import { SendImageMessageDialog } from "@/components/send-image-message-dialog"

describe("send message dialogs", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("pressing Enter confirms image sending instead of cancelling", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <SendImageMessageDialog
        conversationName="产品讨论组"
        image={new File(["image"], "demo.png", { type: "image/png" })}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        sending={false}
      />
    )

    await screen.findByRole("dialog", { name: "发送图片" })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toHaveFocus()
    )
    await user.keyboard("{Enter}")

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("pressing Enter confirms file sending instead of cancelling", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <SendFileMessageDialog
        conversationName="产品讨论组"
        file={new File(["file"], "demo.txt", { type: "text/plain" })}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        sending={false}
      />
    )

    await screen.findByRole("dialog", { name: "发送文件" })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toHaveFocus()
    )
    await user.keyboard("{Enter}")

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
