import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SendImageMessageDialog } from "@/components/send-image-message-dialog"

describe("SendImageMessageDialog", () => {
  beforeEach(() => {
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn(() => "blob:image-preview"),
      },
      revokeObjectURL: {
        configurable: true,
        value: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("registers a non-passive wheel listener on the preview area", async () => {
    const addEventListener = vi.spyOn(HTMLElement.prototype, "addEventListener")

    render(
      <SendImageMessageDialog
        caption=""
        conversationName="测试会话"
        image={new File(["image"], "image.png", { type: "image/png" })}
        onCaptionChange={vi.fn()}
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open
        sending={false}
      />
    )

    const previewImage = await screen.findByRole("img", {
      name: "待发送图片预览",
    })
    const previewArea = previewImage.parentElement?.parentElement

    expect(previewArea).not.toBeNull()
    const hasNonPassiveWheelListener = addEventListener.mock.calls.some(
      ([eventName, , options], index) =>
        addEventListener.mock.instances[index] === previewArea &&
        eventName === "wheel" &&
        typeof options === "object" &&
        options?.passive === false
    )

    expect(hasNonPassiveWheelListener).toBe(true)
    expect(fireEvent.wheel(previewArea!, { deltaY: -1 })).toBe(false)
  })

  it("submits a plain text caption from a single-line input", async () => {
    const onConfirm = vi.fn()

    render(
      <SendImageMessageDialog
        caption="图片说明"
        conversationName="测试会话"
        image={new File(["image"], "image.png", { type: "image/png" })}
        onCaptionChange={vi.fn()}
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        sending={false}
      />
    )

    const captionInput = await screen.findByRole("textbox", {
      name: "图片说明",
    })
    expect(captionInput.tagName).toBe("INPUT")
    expect(captionInput).toHaveValue("图片说明")
    expect(
      screen.queryByRole("button", { name: "图片说明使用 Markdown" })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    expect(onConfirm).toHaveBeenCalledWith("图片说明")
  })

  it("encodes selected caption mentions before sending", async () => {
    const onConfirm = vi.fn()
    const userId = "10000000-0000-0000-0000-000000000001"
    const image = new File(["image"], "image.png", { type: "image/png" })

    function TestDialog() {
      const [caption, setCaption] = React.useState("")

      return (
        <SendImageMessageDialog
          caption={caption}
          conversationName="测试群聊"
          image={image}
          mentionCandidates={[
            {
              avatar: "",
              description: "成员",
              id: userId,
              label: "张三",
              searchText: "张三 zhangsan",
              targetType: "user",
            },
          ]}
          onCaptionChange={setCaption}
          onConfirm={onConfirm}
          onOpenChange={vi.fn()}
          open
          sending={false}
        />
      )
    }

    render(<TestDialog />)

    const captionInput = (await screen.findByRole("textbox", {
      name: "图片说明",
    })) as HTMLInputElement
    fireEvent.change(captionInput, { target: { value: "请看 @张" } })
    captionInput.setSelectionRange(5, 5)
    fireEvent.select(captionInput)
    fireEvent.mouseDown(screen.getByRole("button", { name: /张三/ }))

    expect(captionInput).toHaveValue("请看 @张三 ")
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    expect(onConfirm).toHaveBeenCalledWith(`请看 {(@user/${userId})} `)
  })
})
