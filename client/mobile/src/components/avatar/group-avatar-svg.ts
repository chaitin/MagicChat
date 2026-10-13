export type CompositeAvatarTile = {
  type: "user" | "app"
}

export function buildGroupAvatarSvg(tiles: CompositeAvatarTile[], theme: "light" | "dark", size = 256) {
  const grid = tiles.length <= 4 ? 2 : 3
  const tileSize = size / grid
  const rows = Math.ceil(tiles.length / grid)
  const verticalOffset = (size - rows * tileSize) / 2
  const parts = tiles.map((tile, index) => {
    const row = Math.floor(index / grid)
    const columnsInRow = Math.min(grid, tiles.length - row * grid)
    const x = (size - columnsInRow * tileSize) / 2 + (index % grid) * tileSize
    const y = verticalOffset + row * tileSize
    return fallbackTile(tile.type, x, y, tileSize, theme)
  })
  const background = theme === "dark" ? "#1e1e1e" : "#f7f7f7"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="${background}"/>${parts.join("")}</svg>`
}

function fallbackTile(type: "user" | "app", x: number, y: number, size: number, theme: "light" | "dark") {
  const color = type === "app" ? "#10aeff" : theme === "dark" ? "#1196ff" : "#1485ee"
  const centerX = x + size / 2
  const centerY = y + size / 2
  const radius = size * 0.16
  if (type === "app") {
    return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><rect x="${centerX - radius * 1.7}" y="${centerY - radius * 1.25}" width="${radius * 3.4}" height="${radius * 2.6}" rx="${radius * 0.6}" fill="none" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX - radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><circle cx="${centerX + radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><path d="M ${centerX} ${centerY - radius * 1.25}V ${centerY - radius * 2}" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX}" cy="${centerY - radius * 2.1}" r="${radius * 0.2}" fill="#fff"/></g>`
  }
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><circle cx="${centerX}" cy="${centerY - radius}" r="${radius}" fill="#fff"/><ellipse cx="${centerX}" cy="${centerY + radius * 1.4}" rx="${radius * 1.7}" ry="${radius * 1.3}" fill="#fff"/></g>`
}