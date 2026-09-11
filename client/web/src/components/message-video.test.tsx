import { render, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { MessageVideo } from "@/components/message-video"

const mocks = vi.hoisted(() => ({ readTemporaryFileURLs: vi.fn() }))

vi.mock("@/lib/client-data-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-data-api")>()),
  readTemporaryFileURLs: mocks.readTemporaryFileURLs,
}))

beforeEach(() => vi.clearAllMocks())

it("uses the local preview and removes bottom rounding above a caption", () => {
  const { container } = render(
    <MessageVideo
      roundedBottom={false}
      video={{
        contentType: "video/mp4",
        fileId: "client-video",
        localURL: "blob:local-video",
        name: "demo.mp4",
        sizeBytes: 5,
        type: "video",
      }}
    />
  )

  expect(container.querySelector("video")).toHaveAttribute(
    "src",
    "blob:local-video"
  )
  expect(container.querySelector("video")).toHaveClass("rounded-b-none")
  expect(mocks.readTemporaryFileURLs).not.toHaveBeenCalled()
})

it("resolves a temporary URL for a confirmed video", async () => {
  mocks.readTemporaryFileURLs.mockResolvedValue([
    { fileId: "video-1", url: "https://assets.example.test/video-1" },
  ])
  const { container } = render(
    <MessageVideo
      video={{
        contentType: "video/mp4",
        fileId: "video-1",
        name: "demo.mp4",
        sizeBytes: 5,
        type: "video",
      }}
    />
  )

  await waitFor(() =>
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://assets.example.test/video-1"
    )
  )
})
