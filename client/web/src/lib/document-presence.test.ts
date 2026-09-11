import { describe, expect, it } from "vitest"

import {
  documentPresenceColor,
  normalizeDocumentPresenceUsers,
  safePresenceColor,
} from "./document-presence"

describe("document presence", () => {
  it("assigns a stable color to each user", () => {
    expect(documentPresenceColor("user-1")).toBe(
      documentPresenceColor("user-1")
    )
    expect(documentPresenceColor("user-1")).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("normalizes and deduplicates online users with the current user first", () => {
    expect(
      normalizeDocumentPresenceUsers(
        [
          {
            user: {
              avatar: "/zhou.png",
              color: "#0284c7",
              id: "user-2",
              name: "周宁",
            },
          },
          {
            user: {
              avatar: "",
              color: "#0d9488",
              id: "user-1",
              name: "林晓",
            },
          },
          {
            user: {
              avatar: "",
              color: "#0d9488",
              id: "user-1",
              name: "林晓",
            },
          },
        ],
        "user-1"
      )
    ).toEqual([
      { avatar: "", color: "#0d9488", id: "user-1", name: "林晓" },
      {
        avatar: "/zhou.png",
        color: "#0284c7",
        id: "user-2",
        name: "周宁",
      },
    ])
  })

  it("rejects unsafe presence colors", () => {
    expect(safePresenceColor("red; position: fixed")).toBe("#64748b")
  })
})
