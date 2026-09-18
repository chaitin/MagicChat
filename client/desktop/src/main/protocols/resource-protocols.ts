import { protocol } from "electron"
import type { AuthController } from "../auth-controller"
import type { SelectedMessageFileStore } from "../message-files/selected-message-file-store"

export function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "jiying-avatar",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: "jiying-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

export function registerResourceProtocolHandlers(
  auth: AuthController,
  selectedMessageFiles: SelectedMessageFileStore,
) {
  protocol.handle("jiying-avatar", async (request) => {
    try {
      const url = new URL(request.url)
      const resourceKey = url.hostname === "cache" ? url.pathname.slice(1) : ""
      const resource = await auth.readAvatarResource(resourceKey)
      const body = resource.bytes.buffer.slice(
        resource.bytes.byteOffset,
        resource.bytes.byteOffset + resource.bytes.byteLength,
      ) as ArrayBuffer
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": resource.contentType,
          "Cache-Control": "public, max-age=86400, immutable",
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  protocol.handle("jiying-media", async (request) => {
    try {
      const url = new URL(request.url)
      const [targetId, resourceId] = url.pathname.slice(1).split("/", 2).map(decodeURIComponent)
      if (!targetId || !resourceId) return new Response(null, { status: 404 })
      if (url.hostname === "selection") {
        return selectedMessageFiles.createSelectionResponse(
          targetId,
          resourceId,
          request.headers.get("range") ?? undefined,
        )
      }
      if (url.hostname === "outgoing") {
        return await auth.readOutgoingMedia(
          targetId,
          resourceId,
          request.headers.get("range") ?? undefined,
        )
      }
      if (url.hostname === "cache") {
        return await auth.readCachedMedia(
          targetId,
          resourceId,
          request.headers.get("range") ?? undefined,
        )
      }
      if (url.hostname === "file") {
        return await auth.fetchTemporaryFile(
          targetId,
          resourceId,
          request.headers.get("range") ?? undefined,
        )
      }
      return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
