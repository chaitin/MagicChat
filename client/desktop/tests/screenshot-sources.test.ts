import assert from "node:assert/strict"
import test from "node:test"
import { matchScreenshotSources } from "../src/main/screenshot-sources.ts"

test("多显示器画面按 display_id 对应屏幕，而不是来源顺序", () => {
  const left = { display_id: "1", name: "左屏" }
  const right = { display_id: "2", name: "右屏" }
  assert.deepEqual(matchScreenshotSources([{ id: 2 }, { id: 1 }], [left, right]), [right, left])
})

test("多显示器缺少映射时不误用其他屏幕的画面", () => {
  const displays = [{ id: 1 }, { id: 2 }]
  assert.equal(matchScreenshotSources(displays, [{ display_id: "1" }, { display_id: "" }]), null)
  assert.equal(matchScreenshotSources(displays, [{ display_id: "1" }]), null)
  assert.equal(matchScreenshotSources(displays, [{ display_id: "1" }, { display_id: "1" }]), null)
})

test("单显示器保留缺少 display_id 时的安全回退", () => {
  const only = { display_id: "", name: "屏幕" }
  assert.deepEqual(matchScreenshotSources([{ id: 7 }], [only]), [only])
  assert.equal(matchScreenshotSources([], [only]), null)
})
