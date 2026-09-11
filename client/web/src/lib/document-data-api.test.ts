import { describe, expect, it, vi } from "vitest"

import {
  createClientDocument,
  deleteClientDocument,
  listClientDocuments,
  updateClientDocument,
} from "./document-data-api"

const documentResponse = {
  contributor_count: 2,
  contributors: [
    { avatar: "", id: "user-1", name: "林晓", nickname: "" },
    { avatar: "", id: "user-2", name: "周宁", nickname: "" },
  ],
  created_at: "2026-08-05T09:00:00Z",
  creator: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
  document_type: "document",
  id: "doc-1",
  kind: "document",
  parent_id: null,
  project_id: "project-1",
  schema_version: 1,
  sort_order: 0,
  title: "产品需求文档",
  updated_at: "2026-08-05T09:00:00Z",
  updated_by: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

describe("document data API", () => {
  it("loads and normalizes project documents", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { documents: [documentResponse] } })
      )
    const documents = await listClientDocuments("project-1", fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/projects/project-1/documents",
      expect.objectContaining({ credentials: "include", method: "GET" })
    )
    expect(documents[0]).toMatchObject({
      contributorCount: 2,
      contributors: [{ id: "user-1" }, { id: "user-2" }],
      documentType: "document",
      kind: "document",
      title: "产品需求文档",
    })
  })

  it("creates a folder with an explicit parent", async () => {
    const folder = {
      ...documentResponse,
      document_type: null,
      id: "folder-1",
      kind: "folder",
      parent_id: "folder-parent",
      title: "产品资料",
    }
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: folder }, 201))
    await createClientDocument(
      "project-1",
      { kind: "folder", parentId: "folder-parent", title: "产品资料" },
      fetcher
    )

    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "folder",
      parent_id: "folder-parent",
      title: "产品资料",
    })
  })

  it("creates a Markdown document with its explicit document type", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: {
            ...documentResponse,
            document_type: "markdown",
            title: "开发说明",
          },
        },
        201
      )
    )

    const created = await createClientDocument(
      "project-1",
      {
        documentType: "markdown",
        kind: "document",
        title: "开发说明",
      },
      fetcher
    )

    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      document_type: "markdown",
      kind: "document",
      parent_id: null,
      title: "开发说明",
    })
    expect(created.documentType).toBe("markdown")
  })

  it("preserves null parent updates", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: documentResponse })
      )
    await updateClientDocument(
      "doc-1",
      { parentId: null, sortOrder: 2 },
      fetcher
    )

    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      parent_id: null,
      sort_order: 2,
    })
  })

  it("returns the recursive delete count", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { deleted_count: 3, document_id: "folder-1" },
      })
    )
    await expect(deleteClientDocument("folder-1", fetcher)).resolves.toEqual({
      deletedCount: 3,
      documentId: "folder-1",
    })
  })
})
