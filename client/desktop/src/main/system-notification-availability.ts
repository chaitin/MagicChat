import { execFile } from "node:child_process"

const SERVICE = "org.freedesktop.Notifications"
const RETRY_MS = 30_000

type RunGdbus = (args: string[]) => Promise<string>
const runGdbus: RunGdbus = (args) =>
  new Promise((resolve, reject) => {
    execFile("gdbus", args, { timeout: 1_500, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

export async function hasLinuxNotificationService(run: RunGdbus = runGdbus) {
  const args = [
    "call",
    "--session",
    "--dest",
    "org.freedesktop.DBus",
    "--object-path",
    "/org/freedesktop/DBus",
    "--method",
  ]
  try {
    const owner = (await run([...args, "org.freedesktop.DBus.NameHasOwner", SERVICE])).trim()
    if (owner === "(true,)") return true
    if (owner !== "(false,)") return false
    const activatable = await run([...args, "org.freedesktop.DBus.ListActivatableNames"])
    return /['"]org\.freedesktop\.Notifications['"]/.test(activatable)
  } catch (error) {
    // gdbus is optional on Linux; do not disable working native notifications just for a missing tool.
    return error instanceof Error && "code" in error && error.code === "ENOENT"
  }
}

export class SystemNotificationAvailability {
  private readonly platform: NodeJS.Platform
  private readonly probe: () => Promise<boolean>
  private readonly now: () => number
  private available = true
  private retryAt = 0
  private revision = 0
  private pending: Promise<boolean> | null = null

  constructor(
    platform: NodeJS.Platform = process.platform,
    probe = hasLinuxNotificationService,
    now = Date.now,
  ) {
    this.platform = platform
    this.probe = probe
    this.now = now
  }

  canShow() {
    if (this.now() < this.retryAt) return Promise.resolve(this.available)
    if (this.pending) return this.pending
    const revision = this.revision
    this.pending = Promise.resolve()
      .then(() => (this.platform === "linux" ? this.probe() : true))
      .catch(() => false)
      .then((available) => {
        if (revision === this.revision) {
          this.available = available
          this.retryAt = this.now() + RETRY_MS
        }
        return this.available
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  failed() {
    this.revision += 1
    this.available = false
    this.retryAt = this.now() + RETRY_MS
  }
}
