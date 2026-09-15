import { defineConfig } from "electron-vite"
import renderer from "./vite.renderer.config"

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer,
})
