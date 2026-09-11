export type QrContentClassification =
  | { kind: "text"; content: string }
  | { kind: "web"; url: string }

export function classifyQrContent(content: string): QrContentClassification {
  const candidate = content.trim()

  try {
    const url = new URL(candidate)
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    ) {
      return { kind: "web", url: url.href }
    }
  } catch {
    // Non-URL QR content is intentionally preserved as text.
  }

  return { kind: "text", content }
}
