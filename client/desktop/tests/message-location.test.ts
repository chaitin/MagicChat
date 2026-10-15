import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import { MAX_VISIBLE_MESSAGES } from "../src/shared/message-window.ts"
import { loadMessageLocationContext } from "../src/renderer/features/chat/message-location.ts"

const original = { id: "original", conversationId: "room", seq: 10 } as DesktopMessage
const context = { messages: [original], hasMoreBefore: true, hasMoreAfter: true }
const missing = {
  ok: false,
  error: { code: "message_not_found", message: "本地消息不存在" },
} as const
const input = {
  targetId: "account",
  conversationId: "room",
  messageId: original.id,
  isCurrent: () => true,
}

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
    if (
      name === "locateEffect" &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("void jumpToLocalMessage")
    ) {
      text = `const locateEffect = ${node.arguments[0].getText(source)}`
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(text, `未找到定位回调 ${name}`)
  const compiled = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(
    ...Object.values(scope),
  )
}

const chat = "../src/renderer/features/chat/chat-page.tsx"
const rows = "../src/renderer/features/chat/components/message-list.tsx"

test("引用点击按原消息ID定位，携带来源序号；忽略其他会话", () => {
  const targets: unknown[] = []
  const locate = callback(chat, "locateReplyMessage", {
    selectedId: "room",
    setSearchMessageTarget: (value: unknown) => targets.push(value),
  })
  locate({ conversationId: "room", seq: 80, replyTo: { id: original.id } })
  locate({ conversationId: "other", seq: 80, replyTo: { id: original.id } })
  locate({ conversationId: "room", seq: 80 })
  assert.deepEqual(targets, [{ conversationId: "room", messageId: original.id, beforeSeq: 80 }])
})

test("引用块阻止事件冒泡，多选时不触发定位", () => {
  for (const selectionActive of [false, true]) {
    let stopped = 0,
      located = 0
    const click = callback(rows, "locateReplyMessage", {
      selectionActive,
      message: { replyTo: { id: original.id } },
      onLocateReplyMessage: () => {
        located++
      },
    })
    click({
      stopPropagation() {
        stopped++
      },
    })
    assert.equal(stopped, 1)
    assert.equal(located, selectionActive ? 0 : 1)
  }
  const source = readFileSync(new URL(rows, import.meta.url), "utf8")
  assert.match(
    source,
    /<button\s+type="button"\s+disabled=\{selectionActive\}\s+aria-label="定位被引用的原消息"/,
  )
})

test("已在本地的历史消息直接加载上下文，不拉取远程分页", async () => {
  const calls: unknown[] = []
  const accountData = {
    getLocalMessageContext: async (value: unknown) => {
      calls.push(value)
      return { ok: true as const, data: context }
    },
    loadBeforeMessages: async () => {
      assert.fail("不应拉取历史")
    },
  }
  assert.equal(await loadMessageLocationContext({ ...input, accountData, beforeSeq: 80 }), context)
  assert.deepEqual(calls, [{ targetId: "account", conversationId: "room", messageId: original.id }])
})

test("未缓存原消息逐页补历史后定位，单次分页保持有界", async () => {
  const pages: unknown[] = []
  let count = 0
  const accountData = {
    getLocalMessageContext: async () =>
      count >= 2 ? { ok: true as const, data: context } : missing,
    loadBeforeMessages: async (value: unknown) => {
      pages.push(value)
      count++
      return {
        ok: true as const,
        data: {
          messages: [{ ...original, id: `page-${count}`, seq: count === 1 ? 60 : 40 }],
          hasMoreBefore: true,
        },
      }
    },
  }
  assert.deepEqual(
    await loadMessageLocationContext({ ...input, accountData, beforeSeq: 80 }),
    context,
  )
  assert.deepEqual(
    pages,
    [80, 60].map((beforeSeq) => ({
      targetId: "account",
      conversationId: "room",
      beforeSeq,
      loadedCount: MAX_VISIBLE_MESSAGES,
    })),
  )
})

test("补加载后保留服务端更早历史标记，定位后可继续上翻", async () => {
  let loaded = false
  const accountData = {
    getLocalMessageContext: async () =>
      loaded ? { ok: true as const, data: { ...context, hasMoreBefore: false } } : missing,
    loadBeforeMessages: async () => {
      loaded = true
      return { ok: true as const, data: { messages: [original], hasMoreBefore: true } }
    },
  }
  const result = await loadMessageLocationContext({ ...input, accountData, beforeSeq: 80 })
  assert.equal(result?.hasMoreBefore, true)
})

test("历史已到尽头、空页或游标不前进时提示原消息不可见，不循环", async () => {
  for (const data of [
    { messages: [], hasMoreBefore: true },
    { messages: [{ ...original, seq: 80 }], hasMoreBefore: true },
    { messages: [{ ...original, seq: 60 }], hasMoreBefore: false },
  ]) {
    let pages = 0
    const accountData = {
      getLocalMessageContext: async () => missing,
      loadBeforeMessages: async () => {
        pages++
        return { ok: true as const, data }
      },
    }
    await assert.rejects(
      loadMessageLocationContext({ ...input, accountData, beforeSeq: 80 }),
      /原消息不存在或已不可见/,
    )
    assert.equal(pages, 1)
  }
})

test("权限或网络错误不继续查找历史", async () => {
  const accountData = {
    getLocalMessageContext: async () => ({
      ok: false as const,
      error: { code: "forbidden", message: "无权读取" },
    }),
    loadBeforeMessages: async () => {
      assert.fail("不应继续请求")
    },
  }
  await assert.rejects(
    loadMessageLocationContext({ ...input, accountData, beforeSeq: 80 }),
    /无权读取/,
  )
})

test("切换会话或定位另一条引用后停止继续分页并忽略旧结果", async () => {
  let current = true,
    reads = 0,
    pages = 0
  const accountData = {
    getLocalMessageContext: async () => {
      reads++
      return missing
    },
    loadBeforeMessages: async () => {
      pages++
      current = false
      return { ok: true as const, data: { messages: [original], hasMoreBefore: true } }
    },
  }
  assert.equal(
    await loadMessageLocationContext({
      ...input,
      accountData,
      beforeSeq: 80,
      isCurrent: () => current,
    }),
    null,
  )
  assert.equal(reads, 1)
  assert.equal(pages, 1)
})

test("拒绝错误会话的同ID上下文，搜索定位不启动历史扫描", async () => {
  const accountData = {
    getLocalMessageContext: async () => ({
      ok: true as const,
      data: { ...context, messages: [{ ...original, conversationId: "other" }] },
    }),
    loadBeforeMessages: async () => {
      assert.fail("未提供引用来源序号，不应扫描")
    },
  }
  await assert.rejects(
    loadMessageLocationContext({ ...input, accountData }),
    /原消息不存在或已不可见/,
  )
})

test("可见原消息滚动居中，高亮两秒后清除", () => {
  const frames: Array<() => void> = [],
    timers: Array<{ run: () => void; delay: number }> = [],
    scrolls: unknown[] = []
  let target: unknown = { conversationId: "room", messageId: original.id }
  const effect = callback(chat, "locateEffect", {
    searchMessageTarget: target,
    activeSection: "chat",
    selectedId: "room",
    selected: { id: "room" },
    loadingMessages: false,
    messages: [original],
    locatingSearchRef: { current: null },
    jumpToLocalMessage: () => {
      assert.fail("原消息已可见，不应加载上下文")
    },
    historyRef: {
      current: {
        querySelectorAll: () => [
          {
            dataset: { messageId: original.id },
            scrollIntoView: (value: unknown) => scrolls.push(value),
          },
        ],
      },
    },
    showToast: () => {
      assert.fail("不应显示错误")
    },
    setSearchMessageTarget: (update: (value: unknown) => unknown) => {
      target = update(target)
    },
    window: {
      requestAnimationFrame: (run: () => void) => {
        frames.push(run)
        return 1
      },
      cancelAnimationFrame() {},
      setTimeout: (run: () => void, delay: number) => {
        timers.push({ run, delay })
        return 1
      },
      clearTimeout() {},
    },
  })
  const cleanup = effect()
  frames[0]()
  assert.deepEqual(scrolls, [{ block: "center" }])
  assert.equal(timers[0].delay, 2000)
  timers[0].run()
  assert.equal(target, null)
  cleanup()
})

test("引用定位效果清理后旧请求失效，不抢回新的可见消息", async () => {
  let active!: () => boolean
  const effect = callback(chat, "locateEffect", {
    searchMessageTarget: { conversationId: "room", messageId: original.id, beforeSeq: 80 },
    activeSection: "chat",
    selectedId: "room",
    selected: { id: "room" },
    loadingMessages: false,
    messages: [],
    locatingSearchRef: { current: null },
    jumpToLocalMessage: async (_id: string, _before: number, isCurrent: () => boolean) => {
      active = isCurrent
      return false
    },
    showToast: () => {
      assert.fail("不应显示旧错误")
    },
    setSearchMessageTarget() {},
  })
  const cleanup = effect()
  assert.equal(active(), true)
  cleanup()
  assert.equal(active(), false)
  await Promise.resolve()
})
