import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppInfoProvider } from "@/components/app-info-provider"
import { useAppInfo } from "@/lib/app-info-context"

describe("AppInfoProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps an explicit logout when the initial info request resolves later", async () => {
    const user = userEvent.setup()
    let resolveInfo: ((response: Response) => void) | undefined

    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveInfo = resolve
          })
      )
    )

    render(
      <AppInfoProvider>
        <AuthenticationProbe />
      </AppInfoProvider>
    )

    await user.click(screen.getByRole("button", { name: "标记为已退出" }))

    await act(async () => {
      resolveInfo?.(
        new Response(
          JSON.stringify({
            data: {
              app_name: "即应",
              authenticated: true,
              organization_name: "长亭科技",
              third_party_providers: [],
            },
            success: true,
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          }
        )
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false")
    })
  })
})

function AuthenticationProbe() {
  const { authenticated, setAuthenticated } = useAppInfo()

  return (
    <>
      <div data-testid="authenticated">{String(authenticated)}</div>
      <button onClick={() => setAuthenticated(false)} type="button">
        标记为已退出
      </button>
    </>
  )
}
