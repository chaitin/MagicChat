import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const selectionPlugin = require("../plugins/with-message-selection-menu.js")

const mainActivity = `package cloud.baizhi.chat

import android.os.Bundle
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
}
`

test("点击消息文字区域外会关闭原生菜单并清除选区", () => {
  const generated = selectionPlugin.addMessageSelectionActivityCode(mainActivity)

  assert.match(generated, /private var activeMessageSelectionActionMode: ActionMode\? = null/)
  assert.match(generated, /dismissMessageTextSelectionOutside\(event\)/)
  assert.match(
    generated,
    /getGlobalVisibleRect\(bounds\)[\s\S]*?bounds\.contains\(event\.rawX\.toInt\(\), event\.rawY\.toInt\(\)\)/
  )
  assert.match(
    generated,
    /if \(!touchedSelection\) \{\s*activeMessageSelectionActionMode\?\.finish\(\)/
  )
  assert.match(
    generated,
    /\(textView\.text as\? Spannable\)\?\.let \{ Selection\.removeSelection\(it\) \}/
  )
  assert.match(generated, /override fun onDestroyActionMode[\s\S]*?clearMessageTextSelection\(textView\)/)
})

test("执行复制后也会结束文字选择模式", () => {
  const generated = selectionPlugin.addMessageSelectionActivityCode(mainActivity)

  assert.match(
    generated,
    /val handled = textView\.onTextContextMenuItem\(item\.itemId\)\s*mode\.finish\(\)\s*return handled/
  )
})
