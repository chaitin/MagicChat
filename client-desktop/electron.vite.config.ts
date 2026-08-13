import path from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const sharedRendererDependencies = [
  "@base-ui/react",
  "@dnd-kit/core",
  "@fontsource/jetbrains-mono",
  "@hocuspocus/provider",
  "@tiptap/extension-collaboration",
  "@tiptap/extension-drag-handle-react",
  "@tiptap/extension-placeholder",
  "@tiptap/extension-task-item",
  "@tiptap/extension-task-list",
  "@tiptap/extension-text-align",
  "@tiptap/extension-text-style",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "class-variance-authority",
  "clsx",
  "date-fns",
  "harmonyos-sans-sc-webfont-splitted",
  "lucide-react",
  "konva",
  "next-themes",
  "pinyin-pro",
  "radix-ui",
  "react",
  "react-day-picker",
  "react-dom",
  "react-konva",
  "react-markdown",
  "react-router",
  "recharts",
  "remark-flexible-markers",
  "remark-gfm",
  "remark-supersub",
  "@shikijs/core",
  "@shikijs/engine-javascript",
  "@shikijs/langs",
  "@shikijs/themes",
  "sonner",
  "tailwind-merge",
  "yjs",
]

const processAliases = {
  "@main": path.resolve(__dirname, "src/main"),
  "@preload": path.resolve(__dirname, "src/preload"),
  "@shared": path.resolve(__dirname, "src/shared"),
}

const configuredReleaseChannel = process.env.MAGICCHAT_RELEASE_CHANNEL
const releaseChannel =
  configuredReleaseChannel === "stable" || configuredReleaseChannel === "preview"
    ? configuredReleaseChannel
    : "test"

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        external: ["electron", "electron-log", "electron-updater", "https-proxy-agent", "ws"],
      },
    },
    define: {
      "process.env.MAGICCHAT_RELEASE_CHANNEL": JSON.stringify(releaseChannel),
    },
    resolve: { alias: processAliases },
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        external: ["electron"],
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
    resolve: { alias: processAliases },
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    publicDir: path.resolve(__dirname, "public"),
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/renderer/index.html"),
          recovery: path.resolve(__dirname, "src/renderer/recovery.html"),
          "proxy-auth": path.resolve(__dirname, "src/renderer/proxy-auth.html"),
          capture: path.resolve(__dirname, "src/renderer/capture.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
        ...processAliases,
      },
      dedupe: sharedRendererDependencies,
    },
    server: {
      port: 20050,
      strictPort: true,
      fs: { allow: [__dirname] },
    },
  },
})
