import { describe, expect, it } from "vitest"

import {
  findPrototypeDocumentNode,
  getPrototypeDocumentPath,
} from "@/lib/document-prototype-data"

describe("document prototype data", () => {
  it("finds nested prototype documents", () => {
    expect(findPrototypeDocumentNode("document-1")?.name).toBe("产品需求文档")
    expect(findPrototypeDocumentNode("document-6")?.name).toBe("消息分区设计")
  })

  it("creates routes for rich text and Markdown documents", () => {
    const document = findPrototypeDocumentNode("document-1")
    const markdown = findPrototypeDocumentNode("document-2")

    expect(document?.kind).toBe("document")
    expect(markdown?.kind).toBe("document")
    if (document?.kind !== "document" || markdown?.kind !== "document") {
      throw new Error("prototype document fixture is invalid")
    }

    expect(getPrototypeDocumentPath(document)).toBe(
      "/documents/document/document-1"
    )
    expect(getPrototypeDocumentPath(markdown)).toBe(
      "/documents/markdown/document-2"
    )
  })
})
