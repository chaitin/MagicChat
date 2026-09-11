export type ServerConfig = {
  id: string
  isBuiltIn: boolean
  name: string
  url: string
}

export const OFFICIAL_SERVER_ID = "magicchat-official"

export function isValidServerUrl(value: string) {
  try {
    const url = new URL(value.trim())

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}

export function normalizeServerUrl(value: string) {
  const url = new URL(value.trim())
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"

  return url.toString().replace(/\/$/, "")
}
