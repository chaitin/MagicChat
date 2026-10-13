import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageAttachment } from "./message-attachment"

const mocks = vi.hoisted(() => ({ readURLs: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/client-data-api", async (importOriginal) => ({ ...(await importOriginal()), readTemporaryFileURLs: mocks.readURLs }))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
const file = { fileId: "file-1", name: "项目说明.pdf", sizeBytes: 1024, type: "file" as const }

beforeEach(() => {
  mocks.readURLs.mockReset()
  mocks.error.mockReset()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("MessageAttachment", () => {
  it("renders the Desktop icon/name-size/action row without changing its width", () => {
    const { container } = render(<MessageAttachment file={file} />)
    expect(container.firstElementChild).toHaveClass("flex", "w-80", "items-center", "gap-3")
    expect(screen.getByText(file.name).parentElement).toHaveClass("min-w-0", "flex-1")
    expect(screen.getByText("1 KB").parentElement).toBe(screen.getByText(file.name).parentElement)
    expect(container.querySelector("svg")).toHaveClass("size-7", "text-foreground")
    const button = screen.getByRole("button", { name: `下载 ${file.name}` })
    expect(button).toHaveClass("hover:bg-foreground/5", "active:bg-foreground/5", "dark:hover:bg-foreground/5")
    expect(button.querySelector("svg")).toHaveClass("size-4", "group-hover/message-bubble:text-xgui-brand-5")
  })

  it("uses the browser download and only spins while resolving the read URL", async () => {
    let resolve!: (value: { fileId: string; url: string }[]) => void
    mocks.readURLs.mockReturnValue(new Promise((done) => { resolve = done }))
    const user = userEvent.setup()
    render(<MessageAttachment file={file} />)
    fireEvent.click(screen.getByText(file.name))
    expect(mocks.readURLs).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: `下载 ${file.name}` }))
    const loading = screen.getByRole("button", { name: `正在准备下载 ${file.name}` })
    expect(loading).toBeDisabled()
    expect(loading).toHaveAttribute("aria-busy", "true")
    expect(loading.querySelector("svg")).toHaveClass("animate-spin")
    expect(screen.getByText("准备下载")).toBeInTheDocument()
    await act(async () => resolve([{ fileId: file.fileId, url: "https://assets.example.test/file" }]))
    await waitFor(() => expect(screen.getByRole("button", { name: `下载 ${file.name}` })).toBeEnabled())
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0]
    expect(anchor).toHaveAttribute("download", file.name)
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
    expect(anchor).toHaveAttribute("target", "_blank")
    expect(screen.getByText("1 KB")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /打开/ })).not.toBeInTheDocument()
    expect(mocks.readURLs).toHaveBeenCalledExactlyOnceWith([file.fileId])
  })

  it("allows retry after failure without displaying a fake cached state", async () => {
    mocks.readURLs.mockRejectedValue(new Error("offline"))
    const user = userEvent.setup()
    render(<MessageAttachment file={file} />)
    await user.click(screen.getByRole("button", { name: `下载 ${file.name}` }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("下载文件失败"))
    expect(screen.getByRole("button", { name: `下载 ${file.name}` })).toBeEnabled()
  })
})
