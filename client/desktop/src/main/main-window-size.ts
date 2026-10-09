import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"

export type MainWindowSize = { width: number; height: number }

export const DEFAULT_MAIN_WINDOW_SIZE: MainWindowSize = { width: 1080, height: 760 }
export const MIN_MAIN_WINDOW_SIZE: MainWindowSize = { width: 760, height: 560 }

export function isMainWindowSize(value: unknown): value is MainWindowSize {
  if (!value || typeof value !== "object") return false
  const { width, height } = value as Partial<MainWindowSize>
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width! >= MIN_MAIN_WINDOW_SIZE.width &&
    height! >= MIN_MAIN_WINDOW_SIZE.height &&
    width! <= 10_000 &&
    height! <= 10_000
  )
}

export class MainWindowSizeStore {
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "main-window-state.json")
  }

  load(): MainWindowSize {
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, "utf8"))
      if (isMainWindowSize(value)) return { width: value.width, height: value.height }
    } catch {
      // Missing or damaged window state falls back to the default size.
    }
    return { ...DEFAULT_MAIN_WINDOW_SIZE }
  }

  save(size: MainWindowSize) {
    if (!isMainWindowSize(size)) return
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    writeFileSync(`${this.filePath}.tmp`, JSON.stringify(size), { mode: 0o600 })
    renameSync(`${this.filePath}.tmp`, this.filePath)
  }
}
