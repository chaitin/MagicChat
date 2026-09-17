import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "electron-vite"
import renderer from "./vite.renderer.config"

const directory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: path.join(directory, "src/preload/index.ts"),
          mediaPreview: path.join(directory, "src/preload/media-preview.ts"),
          screenshot: path.join(directory, "src/preload/screenshot.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer,
})
