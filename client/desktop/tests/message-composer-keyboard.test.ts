import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function callback(path: string, name: string, scope: Record<string, unknown>): Function {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let text = ""
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source)
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      text = `const ${name} = ${node.initializer.arguments[0].getText(source)}`
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(text, `未找到实际键盘回调 ${name}`)
  const compiled = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(
    ...Object.values(scope),
  )
}

function harness(mentions: boolean, value = "第一行", start = value.length, end = start) {
  let sends = 0,
    inserts = 0,
    prevented = false
  let trigger: unknown = mentions ? { query: "", start: 0 } : null
  let selectedIndex = 0
  const frames: Array<() => void> = []
  const textarea = {
    value,
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange(from: number, to: number) {
      this.selectionStart = from
      this.selectionEnd = to
    },
  }
  const onKeyDown = callback(
    "../src/renderer/features/chat/chat-page.tsx",
    "handleComposerKeyDown",
    {
      sendDraft: () => {
        sends++
      },
    },
  )
  const handler = callback(
    "../src/renderer/features/chat/components/message-composer.tsx",
    "handleKeyDown",
    {
      onKeyDown,
      mentionTrigger: trigger,
      filteredCandidates: mentions ? [{ id: "u1" }] : [],
      selectedMentionIndex: 0,
      insertCandidate: () => {
        inserts++
      },
      onDraftChange: (next: string) => {
        textarea.value = next
      },
      setMentionTrigger: (next: unknown) => {
        trigger = next
      },
      setSelectedMentionIndex: (next: number) => {
        selectedIndex = next
      },
      requestAnimationFrame: (fn: () => void) => {
        frames.push(fn)
      },
    },
  )
  return {
    key(options: Record<string, unknown>) {
      handler({
        key: "Enter",
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        altKey: false,
        keyCode: 13,
        nativeEvent: { isComposing: false },
        currentTarget: textarea,
        preventDefault: () => {
          prevented = true
        },
        ...options,
      })
      frames.forEach((fn) => fn())
      return { sends, inserts, prevented, trigger, selectedIndex, ...textarea }
    },
  }
}

for (const mentions of [false, true]) {
  for (const modifiers of [
    { ctrlKey: true },
    { shiftKey: true },
    { ctrlKey: true, shiftKey: true },
  ]) {
    test(`组合键换行且不发送或选择候选：${JSON.stringify(modifiers)}，候选菜单=${mentions}`, () => {
      const result = harness(mentions).key(modifiers)
      assert.equal(result.value, "第一行\n")
      assert.equal(result.selectionStart, 4)
      assert.equal(result.selectionEnd, 4)
      assert.equal(result.prevented, true)
      assert.equal(result.sends, 0)
      assert.equal(result.inserts, 0)
      assert.equal(result.trigger, null)
    })
  }
}

for (const modifiers of [{ ctrlKey: true }, { shiftKey: true }]) {
  test(`光标中间选区替换为换行并恢复光标：${JSON.stringify(modifiers)}`, () => {
    const result = harness(false, "前文选中文字后文", 2, 6).key(modifiers)
    assert.equal(result.value, "前文\n后文")
    assert.equal(result.selectionStart, 3)
    assert.equal(result.selectionEnd, 3)
  })
}

test("普通Enter继续发送，候选菜单中的Enter或Tab继续选择候选", () => {
  assert.equal(harness(false).key({}).sends, 1)
  for (const key of ["Enter", "Tab"]) {
    const result = harness(true).key({ key })
    assert.equal(result.inserts, 1)
    assert.equal(result.sends, 0)
    assert.equal(result.value, "第一行")
  }
})

for (const composition of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
  test(`输入法选词期间不换行、不发送或选择候选：${JSON.stringify(composition)}`, () => {
    const result = harness(true).key({ ctrlKey: true, ...composition })
    assert.equal(result.value, "第一行")
    assert.equal(result.sends, 0)
    assert.equal(result.inserts, 0)
    assert.equal(result.prevented, false)
  })
}
