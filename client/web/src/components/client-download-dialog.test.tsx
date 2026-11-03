import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { ClientDownloadDialog } from "@/components/client-download-dialog"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("从资源域名检查版本，失败时各平台仍使用新域名的备用下载地址", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false })
  vi.stubGlobal("fetch", fetcher)
  const user = userEvent.setup()
  render(<ClientDownloadDialog />)

  await user.click(screen.getByRole("button", { name: "下载客户端" }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  expect(fetcher).toHaveBeenCalledWith(
    "https://assets.jiying.chat/releases/version.json",
    expect.objectContaining({ signal: expect.anything() })
  )

  for (const [platform, file] of [
    ["Android", "jiying.apk"],
    ["Windows", "jiying.exe"],
    ["macOS", "jiying.dmg"],
  ]) {
    expect(screen.getByLabelText(`下载 ${platform} 客户端`)).toHaveAttribute(
      "href", `https://assets.jiying.chat/releases/${file}`
    )
  }
  expect(screen.getByLabelText("下载 iOS 客户端").getAttribute("href")).toMatch(/apps[.]apple[.]com/)

  await user.click(screen.getByRole("button", { name: "下载 Linux 客户端" }))
  expect(await screen.findByLabelText("下载 Linux x64 / AMD64 客户端")).toHaveAttribute(
    "href", "https://assets.jiying.chat/releases/jiying.amd.AppImage"
  )
  expect(screen.getByLabelText("下载 Linux ARM64 客户端")).toHaveAttribute(
    "href", "https://assets.jiying.chat/releases/jiying.arm.AppImage"
  )
})
