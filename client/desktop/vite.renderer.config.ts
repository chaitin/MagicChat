import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

const directory = path.dirname(fileURLToPath(import.meta.url))
const developmentNonce = randomBytes(18).toString("base64")

export default defineConfig({
  root: path.join(directory, "src/renderer"),
  base: "./",
  html: { cspNonce: developmentNonce },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "development-csp",
      transformIndexHtml(html, context) {
        if (!context.server) return html
        // React 热更新需要内联引导脚本；仅开发时允许带随机 nonce 的脚本。
        return html
          .replace("script-src 'self'", `script-src 'self' 'nonce-${developmentNonce}'`)
          .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:20110")
      },
    },
  ],
  resolve: { alias: { "@": path.join(directory, "src/renderer") } },
  server: {
    host: "127.0.0.1",
    port: 20110,
    strictPort: true,
    fs: { allow: [directory, path.resolve(directory, "../../assets")] },
  },
})
