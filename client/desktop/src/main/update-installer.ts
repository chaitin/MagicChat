import { spawn, type ChildProcess } from "node:child_process"
import type { ReleasePlatform } from "../shared/desktop"

export async function openDownloadedUpdate({
  platform,
  filePath,
  openPath,
  showItemInFolder,
  quit,
  spawnInstaller = spawn,
}: {
  platform: ReleasePlatform
  filePath: string
  openPath: (filePath: string) => Promise<string>
  showItemInFolder: (filePath: string) => void
  quit: () => void
  spawnInstaller?: typeof spawn
}): Promise<void> {
  if (platform === "windows") {
    const child: ChildProcess = spawnInstaller(filePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
    quit()
  } else if (platform === "macos") {
    const error = await openPath(filePath)
    if (error) throw new Error(`无法打开安装镜像：${error}`)
  } else {
    showItemInFolder(filePath)
  }
}
