import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ExpressionPickerPopover } from "@/components/expression-picker-popover"

describe("ExpressionPicker", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("provides a reusable popover that closes after selection", async () => {
    const onSelect = vi.fn()
    render(
      <ExpressionPickerPopover onSelect={onSelect}>
        <button type="button">打开表情</button>
      </ExpressionPickerPopover>
    )

    fireEvent.click(screen.getByRole("button", { name: "打开表情" }))
    const allSection = screen.getByRole("region", { name: "所有表情" })
    fireEvent.click(within(allSection).getByRole("button", { name: "握手" }))

    expect(onSelect).toHaveBeenCalledWith({
      label: "握手",
      type: "emoji",
      value: "🤝",
    })
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "所有表情" })
      ).not.toBeInTheDocument()
    )
  })
})
