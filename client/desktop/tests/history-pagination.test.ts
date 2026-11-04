import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import type { DesktopMessage } from "../src/shared/account-data"
import {
  boundMessageWindow,
  hasEarlierMessages,
  mergeRefreshedMessages,
  visibleMessageGap,
} from "../src/renderer/features/chat/bounded-message-window.ts"
import { isConfirmedMessage, mergeLocalMessageWindows } from "../src/shared/message-window.ts"

function messages(start: number, end: number): DesktopMessage[] {
  return Array.from({ length: end - start + 1 }, (_, index) => ({
    id: `m${start + index}`,
    seq: start + index,
    createdAt: "2026-01-01T00:00:00Z",
  })) as DesktopMessage[]
}

test("刷新结果晚于历史分页返回时保留已加载历史", () => {
  const refreshed = messages(51, 100)
  const history = messages(31, 100)
  const result = mergeRefreshedMessages(history, refreshed, false)
  assert.equal(result.messages[0].seq, 31)
  assert.equal(result.messages.at(-1)?.seq, 100)
})

test("先刷新再加载历史与先加载历史再刷新保留相同消息", () => {
  const current = messages(51, 100)
  const incoming = messages(51, 101)
  const older = messages(31, 50)
  const refreshFirst = mergeRefreshedMessages(current, incoming, false).messages
  const historyFirst = [...older, ...current]
  assert.deepEqual(mergeRefreshedMessages(historyFirst, incoming, false).messages, [
    ...older,
    ...refreshFirst,
  ])
})

test("刷新保留历史的同时应用已有消息的更新", () => {
  const incoming = messages(51, 100)
  incoming[0] = { ...incoming[0], content: "updated" }
  const result = mergeRefreshedMessages(messages(31, 100), incoming, false)
  assert.equal(result.messages.find((message) => message.seq === 51)?.content, "updated")
  assert.equal(result.messages[0].seq, 31)
})

test("浏览历史时超出窗口上限裁剪尾部而非正在查看的历史", () => {
  const result = mergeRefreshedMessages(messages(1, 200), messages(151, 210), false)
  assert.equal(result.messages.length, 200)
  assert.equal(result.messages[0].seq, 1)
  assert.equal(result.removedAfter, true)
  const latest = mergeRefreshedMessages(messages(1, 200), messages(151, 210), true)
  assert.equal(latest.messages.at(-1)?.seq, 210)
  assert.equal(latest.removedBefore, true)
})

test("话题源消息不变仍能识别历史分页进展", () => {
  const source = { id: "source", seq: 0, virtualType: "topic_source" } as DesktopMessage
  assert.equal(
    hasEarlierMessages([source, ...messages(51, 100)], [source, ...messages(31, 100)]),
    true,
  )
})

for (const status of ["sending", "failed"] as const) {
  test(`${status}的较小临时序号不阻止识别真正的历史分页进展`, () => {
    const pending = { ...messages(1, 1)[0], id: "pending", deliveryStatus: status }
    assert.equal(
      hasEarlierMessages([pending, ...messages(51, 100)], [pending, ...messages(31, 100)]),
      true,
    )
  })

  test(`仅新增${status}临时项不算加载了更早的正式消息`, () => {
    const pending = { ...messages(1, 1)[0], id: "pending", deliveryStatus: status }
    assert.equal(hasEarlierMessages(messages(51, 100), [pending, ...messages(51, 100)]), false)
  })
}

for (const status of ["sending", "failed"] as const) {
  test(`真实历史加载回调忽略${status}序号与计数，并保留临时消息且不误报重试`, async () => {
    const pending = {
      ...messages(1, 1)[0],
      id: "pending-before",
      conversationId: "room",
      deliveryStatus: status,
    }
    const state = {
      messages: [
        pending,
        ...messages(51, 100).map((message) => ({ ...message, conversationId: "room" })),
        { ...pending, id: "pending-after", seq: 1000 },
      ],
      error: false,
      hasMore: false,
    }
    const requests: Array<{ beforeSeq: number; loadedCount: number }> = []
    const toasts: unknown[] = []
    const load = createHistoryLoader({
      window: {
        desktop: {
          accountData: {
            loadBeforeMessages: async (input: { beforeSeq: number; loadedCount: number }) => {
              requests.push(input)
              return {
                ok: true,
                data: {
                  messages: messages(31, 50).map((message) => ({
                    ...message,
                    conversationId: "room",
                  })),
                  hasMoreBefore: true,
                },
              }
            },
          },
        },
      },
      selectedId: "room",
      targetId: "account",
      loadingMessages: false,
      hasMoreBeforeMessages: true,
      messagesRef: { current: state.messages },
      locatingWindowRef: { current: null },
      loadingBeforeRef: { current: false },
      historyRef: { current: {} },
      selectedIdRef: { current: "room" },
      messageWindowRevisionRef: { current: 0 },
      scrollSnapshotRef: { current: null },
      pendingHistoryRefreshRef: { current: false },
      browsingOlderWindowRef: { current: false },
      isConfirmedMessage,
      mergeLocalMessageWindows,
      boundMessageWindow,
      hasEarlierMessages,
      visibleMessageGap,
      captureMessageScroll: () => null,
      setLoadingBeforeMessages: () => {},
      setBeforeMessagesError: (value: boolean) => {
        state.error = value
      },
      setHasMoreBeforeMessages: (value: boolean) => {
        state.hasMore = value
      },
      setMessages: (value: DesktopMessage[]) => {
        state.messages = value
      },
      setMessageGap: () => {},
      setHasMoreAfterMessages: () => {},
      setMessageRevision: () => {},
      showToast: (value: unknown) => {
        toasts.push(value)
      },
    })
    await load()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].beforeSeq, 51)
    assert.equal(requests[0].loadedCount, 50)
    assert.equal(state.error, false)
    assert.equal(state.hasMore, true)
    assert.equal(state.messages.find(isConfirmedMessage)?.seq, 31)
    assert.equal(state.messages.filter((message) => message.deliveryStatus === status).length, 2)
    assert.equal(toasts.length, 0)
  })
}

function createHistoryLoader(scope: Record<string, unknown>) {
  const source = ts.createSourceFile(
    "use-chat-data.ts",
    readFileSync(
      new URL("../src/renderer/features/chat/hooks/use-chat-data.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  let callback = ""
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "loadBeforeMessages" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callback = node.initializer.arguments[0].getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(callback, "必须执行真实的历史加载回调")
  const compiled = ts.transpileModule(`(${callback})`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(compiled, scope) as () => Promise<void>
}

test("重复页及只有虚拟消息变化不算历史分页进展", () => {
  const current = messages(51, 100)
  assert.equal(hasEarlierMessages(current, messages(51, 100)), false)
  assert.equal(
    hasEarlierMessages(current, [
      { id: "source", seq: 0, virtualType: "topic_source" } as DesktopMessage,
      ...current,
    ]),
    false,
  )
})
