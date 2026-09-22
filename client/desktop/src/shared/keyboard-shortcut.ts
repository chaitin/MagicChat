import type { DesktopPlatform } from "./desktop"

export function matchesKeyboardShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  accelerator: string,
  platform: DesktopPlatform,
) {
  const parts = accelerator.toLowerCase().replaceAll(" ", "").split("+")
  const key = parts.at(-1)
  if (!key) return false
  const modifiers = new Set(parts.slice(0, -1))
  const commandOrControl = modifiers.has("commandorcontrol")
  const expectsControl = modifiers.has("control") || (commandOrControl && platform !== "macos")
  const expectsCommand =
    modifiers.has("command") || modifiers.has("super") || (commandOrControl && platform === "macos")

  return (
    event.ctrlKey === expectsControl &&
    event.metaKey === expectsCommand &&
    event.altKey === modifiers.has("alt") &&
    event.shiftKey === modifiers.has("shift") &&
    keyboardEventKey(event) === key
  )
}

export function formatKeyboardShortcut(shortcut: string, platform: DesktopPlatform) {
  return shortcut
    .replace("CommandOrControl", platform === "macos" ? "Command" : "Control")
    .replaceAll("Control", "Ctrl")
    .split("+")
    .join(" + ")
    .toLowerCase()
}

function keyboardEventKey(event: Pick<KeyboardEvent, "code" | "key">) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  const keys: Record<string, string> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    " ": "space",
  }
  return keys[event.key] ?? event.key.toLowerCase()
}
