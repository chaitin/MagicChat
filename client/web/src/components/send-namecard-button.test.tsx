import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { NamecardDialogHost, SendNamecardButton } from "./send-namecard-button"

const mocks = vi.hoisted(() => ({
  data: {
    me: { id: "account" },
    conversations: [] as unknown[],
    sendConversationCard: vi.fn(),
  },
}))
vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => mocks.data,
}))
vi.mock("@/components/conversation/forward-message-dialog", () => ({
  ForwardMessageDialog: (props: {
    onForward: (ids: string[]) => Promise<unknown>
    onComplete: () => void
    purpose: string
  }) => (
    <button
      onClick={() =>
        void props.onForward(["destination"]).then(props.onComplete)
      }
    >
      {props.purpose}
    </button>
  ),
}))

describe("发送名片入口", () => {
  it.each(["user", "app", "group"] as const)(
    "发送%s资料时使用entity_card，由服务端生成资料",
    async (type) => {
      mocks.data.me = { id: "account" }
      mocks.data.sendConversationCard
        .mockReset()
        .mockResolvedValue({ id: "sent" })
      const user = userEvent.setup()
      render(
        <>
          <NamecardDialogHost />
          <SendNamecardButton
            target={{ type, id: "550e8400-e29b-41d4-a716-446655440000" }}
          />
        </>
      )
      await user.click(screen.getByRole("button", { name: "推荐给好友" }))
      await user.click(screen.getByRole("button", { name: "namecard" }))
      await waitFor(() =>
        expect(mocks.data.sendConversationCard).toHaveBeenCalledWith(
          "destination",
          {
            type: "entity_card",
            entityType: type,
            entityId: "550e8400-e29b-41d4-a716-446655440000",
          },
          { clientMessageId: expect.any(String) }
        )
      )
      await waitFor(() =>
        expect(screen.queryByText("namecard")).not.toBeInTheDocument()
      )
    }
  )

  it("切换账号关闭旧名片选择框，不把旧选择带到新账号", async () => {
    mocks.data.me = { id: "account" }
    const view = render(
      <>
        <NamecardDialogHost />
        <SendNamecardButton
          target={{ type: "user", id: "550e8400-e29b-41d4-a716-446655440000" }}
        />
      </>
    )
    await userEvent.click(screen.getByRole("button", { name: "推荐给好友" }))
    expect(screen.getByText("namecard")).toBeInTheDocument()
    act(() => {
      mocks.data.me = { id: "other" }
    })
    view.rerender(
      <>
        <NamecardDialogHost />
        <SendNamecardButton
          target={{ type: "user", id: "550e8400-e29b-41d4-a716-446655440000" }}
        />
      </>
    )
    expect(screen.queryByText("namecard")).not.toBeInTheDocument()
  })
})
