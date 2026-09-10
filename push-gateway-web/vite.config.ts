import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 20061,
    proxy: {
      "/api": {
        changeOrigin: true,
        target: process.env.PUSH_GATEWAY_API_URL ?? "http://127.0.0.1:20062",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
