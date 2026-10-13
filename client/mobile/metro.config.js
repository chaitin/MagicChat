const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../../assets/fonts/misans"),
  path.resolve(__dirname, "../../assets/fonts/noto-color-emoji"),
]

module.exports = config
