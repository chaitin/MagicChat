import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_SHORTCUTS } from "../src/shared/desktop.ts"
import { formatKeyboardShortcut, matchesKeyboardShortcut } from "../src/shared/keyboard-shortcut.ts"

test("快捷键默认值包含应用内搜索", () => {
  assert.equal(DEFAULT_SHORTCUTS.showWindow, "Alt+J")
  assert.equal(DEFAULT_SHORTCUTS.search, "CommandOrControl+F")
})

test("快捷键使用平台对应名称并以小写展示", () => {
  assert.equal(formatKeyboardShortcut(DEFAULT_SHORTCUTS.search, "windows"), "ctrl + f")
  assert.equal(formatKeyboardShortcut(DEFAULT_SHORTCUTS.search, "macos"), "command + f")
  assert.equal(formatKeyboardShortcut("Control+K", "linux"), "ctrl + k")
  assert.equal(formatKeyboardShortcut(DEFAULT_SHORTCUTS.showWindow, "windows"), "alt + j")
})

test("应用内搜索按平台匹配 Control 或 Command", () => {
  assert.equal(
    matchesKeyboardShortcut(keyEvent({ ctrlKey: true }), DEFAULT_SHORTCUTS.search, "windows"),
    true,
  )
  assert.equal(
    matchesKeyboardShortcut(keyEvent({ metaKey: true }), DEFAULT_SHORTCUTS.search, "macos"),
    true,
  )
  assert.equal(
    matchesKeyboardShortcut(keyEvent({ ctrlKey: true }), DEFAULT_SHORTCUTS.search, "macos"),
    false,
  )
  assert.equal(
    matchesKeyboardShortcut(
      keyEvent({ ctrlKey: true, shiftKey: true }),
      DEFAULT_SHORTCUTS.search,
      "linux",
    ),
    false,
  )
})

function keyEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    code: "KeyF",
    ctrlKey: false,
    key: "f",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}
