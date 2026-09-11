import * as React from "react"

export type DocumentImageResolution =
  | { status: "failed" }
  | { status: "loading" }
  | { expiresAt: string; status: "ready"; url: string }

export type DocumentImageResolutionContextValue = {
  refresh: (fileId: string) => void
  resolutions: ReadonlyMap<string, DocumentImageResolution>
}

export const DocumentImageResolutionContext =
  React.createContext<DocumentImageResolutionContextValue>({
    refresh: () => undefined,
    resolutions: new Map(),
  })
