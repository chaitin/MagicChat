const { defineConfig } = require("eslint/config")
const expoConfig = require("eslint-config-expo/flat")

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "expo-sqlite", message: "SQLite connections are private to the database service." }],
        patterns: [{
          group: ["@/data/database/database-service-core", "**/data/database/database-service-core"],
          message: "Import the public database-service module instead of its internal implementation.",
        }],
      }],
    },
  },
  {
    files: ["src/data/database/database-service.ts"],
    rules: {
      // This is the one connection-owning module. Keep this allow-list exact.
      "no-restricted-imports": "off",
    },
  },
])
