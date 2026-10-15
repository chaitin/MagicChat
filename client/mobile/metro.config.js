const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)
config.watchFolders = [
  ...(config.watchFolders ?? []),
  // app.json disables on-demand export so these external directories remain indexed.
  path.resolve(__dirname, "../shared"),
  path.resolve(__dirname, "../../assets/fonts/misans"),
  path.resolve(__dirname, "../../assets/fonts/noto-color-emoji"),
]

module.exports = config
