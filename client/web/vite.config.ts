import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const clientApiProxyTarget =
  process.env.TARGET?.trim() || "http://localhost:20080"
const documentCollaborationProxyTarget =
  process.env.DOCUMENT_SERVER_TARGET?.trim() || "http://localhost:20100"
const documentCollaborationProxyOrigin = new URL(
  documentCollaborationProxyTarget
).origin
const clientBuildCommit =
  process.env.VITE_CLIENT_BUILD_COMMIT?.trim() || "development"

export function createClientVersionManifest(commit: string) {
  return `${JSON.stringify({ commit })}\n`
}

function clientVersionManifestPlugin(commit: string): Plugin {
  return {
    name: "client-version-manifest",
    generateBundle() {
      this.emitFile({
        fileName: "version.json",
        source: createClientVersionManifest(commit),
        type: "asset",
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    clientVersionManifestPlugin(clientBuildCommit),
  ],
  server: {
    allowedHosts: ["maosite.cc"],
    port: 20070,
    proxy: {
      "/api/client/document/collaboration": {
        changeOrigin: true,
        headers: { Origin: documentCollaborationProxyOrigin },
        rewriteWsOrigin: true,
        secure: false,
        target: documentCollaborationProxyTarget,
        ws: true,
      },
      "/api/app/ws": {
        changeOrigin: true,
        rewriteWsOrigin: true,
        secure: false,
        target: clientApiProxyTarget,
        ws: true,
      },
      "/api/client/ws": {
        changeOrigin: true,
        rewriteWsOrigin: true,
        secure: false,
        target: clientApiProxyTarget,
        ws: true,
      },
      "/api/client": {
        changeOrigin: false,
        secure: false,
        target: clientApiProxyTarget,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
