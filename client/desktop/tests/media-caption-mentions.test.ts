import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import {
  createDraftMentionTemplate,
  createMentionCandidates,
  filterMentionCandidates,
  getMentionTrigger,
  insertDraftMention,
  syncDraftMentions,
  type DraftMention,
  type MentionCandidate,
} from "../src/renderer/features/chat/conversation-mentions.ts"

function source(path: string) {
  const url = new URL(path, import.meta.url)
  return ts.createSourceFile(
    url.pathname,
    readFileSync(url, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
}
const dialog = source("../src/renderer/features/chat/send-media-message-dialog.tsx")
function callback(file: ts.SourceFile, name: string, scope: Record<string, unknown>) {
  let text = ""
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(file)
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      text = `const ${name} = ${node.initializer.arguments[0].getText(file)}`
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(text, `找不到 ${name}`)
  const compiled = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(
    ...Object.values(scope),
  )
}

const aliceId = "00000000-0000-0000-0000-000000000011"
const bobId = "00000000-0000-0000-0000-000000000012"
function group(id = "group-a"): DesktopConversation {
  return {
    id,
    type: "group",
    members: [
      {
        id: aliceId,
        type: "user",
        name: "张三",
        nickname: "阿丽",
        email: "alice@example.com",
        phone: "13800138000",
      },
      {
        id: bobId,
        type: "user",
        name: "李四",
        nickname: "",
        email: "bob@example.com",
        phone: "13900139000",
      },
    ],
  } as DesktopConversation
}
const candidates = createMentionCandidates(group(), [group()])

function harness(initial = "@") {
  let caption = initial,
    captionMentions: DraftMention[] = [],
    mentionTrigger = getMentionTrigger(initial, initial.length),
    selectedMentionIndex = 0
  let sending = false
  const confirmed: string[] = [],
    frames: (() => void)[] = []
  const input = {
    selectionStart: initial.length,
    focus() {},
    setSelectionRange(start: number, _end: number) {
      this.selectionStart = start
    },
  }
  function scope(): Record<string, unknown> {
    return {
      caption,
      captionMentions,
      mentionTrigger,
      selectedMentionIndex,
      sending,
      resourceUrl: "blob:preview",
      mentionCandidates: candidates,
      filteredCandidates: filterMentionCandidates(candidates, mentionTrigger?.query ?? ""),
      captionInputRef: { current: input },
      getMentionTrigger,
      filterMentionCandidates,
      insertDraftMention,
      syncDraftMentions,
      createDraftMentionTemplate,
      onCaptionChange: (value: string) => {
        caption = value
      },
      onConfirm: (value: string) => confirmed.push(value),
      setCaptionMentions: (
        update: DraftMention[] | ((current: DraftMention[]) => DraftMention[]),
      ) => {
        captionMentions = typeof update === "function" ? update(captionMentions) : update
      },
      setMentionTrigger: (value: typeof mentionTrigger) => {
        mentionTrigger = value
      },
      setSelectedMentionIndex: (update: number | ((current: number) => number)) => {
        selectedMentionIndex = typeof update === "function" ? update(selectedMentionIndex) : update
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      updateMentionTrigger: (value: string, cursor: number) =>
        call("updateMentionTrigger", value, cursor),
      insertCandidate: (candidate: MentionCandidate) => call("insertCandidate", candidate),
      confirm: () => call("confirm"),
    }
  }
  function call(name: string, ...args: unknown[]) {
    return callback(dialog, name, scope())(...args)
  }
  function key(key: string, composing = false, keyCode = 0) {
    let prevented = false,
      stopped = false
    call("handleKeyDown", {
      key,
      keyCode,
      nativeEvent: { isComposing: composing },
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: () => {
        stopped = true
      },
    })
    return { prevented, stopped }
  }
  return {
    call,
    key,
    scope,
    input,
    confirmed,
    flush: () => {
      while (frames.length) frames.shift()!()
    },
    setSending: (value: boolean) => {
      sending = value
    },
    get caption() {
      return caption
    },
    get trigger() {
      return mentionTrigger
    },
    get index() {
      return selectedMentionIndex
    },
  }
}

test("图片说明使用聊天相同候选及搜索，支持姓名昵称拼音邮箱和手机号", () => {
  for (const query of ["阿丽", "张三", "ali", "zs", "alice", "138001"]) {
    assert.equal(filterMentionCandidates(candidates, query)[0]?.id, aliceId)
  }
  const h = harness("看看 @a 后续")
  h.input.selectionStart = h.caption.indexOf(" 后续")
  h.call("updateMentionTrigger", h.caption, h.input.selectionStart)
  assert.deepEqual(h.trigger, { start: 3, query: "a" })
  h.call("insertCandidate", candidates[1])
  h.flush()
  assert.equal(h.caption, "看看 @阿丽  后续")
  assert.equal(h.input.selectionStart, 7)
  h.call("confirm")
  assert.deepEqual(h.confirmed, [`看看 {(@user/${aliceId})}  后续`])
})

test("上下键循环选择，Enter先插入提及，再次Enter才发送；Tab也可确认", () => {
  const h = harness()
  assert.equal(h.key("ArrowDown").prevented, true)
  assert.equal(h.index, 1)
  assert.deepEqual(h.key("Enter"), { prevented: true, stopped: true })
  h.flush()
  assert.deepEqual(h.confirmed, [])
  assert.equal(h.caption, "@阿丽 ")
  h.key("Enter")
  assert.deepEqual(h.confirmed, [`{(@user/${aliceId})} `])
  const tab = harness()
  tab.key("ArrowUp")
  assert.equal(tab.index, candidates.length - 1)
  assert.deepEqual(tab.key("Tab"), { prevented: true, stopped: true })
  assert.equal(tab.caption, "@李四 ")
  assert.deepEqual(tab.confirmed, [])
})

test("IME确认和229键码不会选择成员或发送，发送中不接受编辑", () => {
  const h = harness()
  for (const [composing, code] of [
    [true, 0],
    [false, 229],
  ] as const) {
    assert.equal(h.key("Enter", composing, code).prevented, false)
    assert.equal(h.caption, "@")
    assert.deepEqual(h.confirmed, [])
  }
  h.setSending(true)
  h.call("insertCandidate", candidates[1])
  h.key("Enter")
  h.call("confirm")
  assert.equal(h.caption, "@")
  assert.deepEqual(h.confirmed, [])
})

test("Escape优先关闭提及菜单，不关闭媒体弹窗", () => {
  const h = harness()
  assert.deepEqual(h.key("Escape"), { prevented: true, stopped: true })
  assert.equal(h.trigger, null)
  assert.deepEqual(h.confirmed, [])
  let text = ""
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(dialog) === "onEscapeKeyDown" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    )
      text = node.initializer.expression!.getText(dialog)
    ts.forEachChild(node, visit)
  }
  visit(dialog)
  assert.ok(text)
  let prevented = false,
    trigger: unknown = {}
  new Function("mentionTrigger", "setMentionTrigger", `return (${text});`)(
    trigger,
    (next: unknown) => {
      trigger = next
    },
  )({
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(trigger, null)
})

test("修改说明会同步提及位置，改写或删除姓名后不再发送原用户ID", () => {
  const h = harness()
  h.call("insertCandidate", candidates[1])
  h.call("changeCaption", `前缀${h.caption}`)
  h.call("confirm")
  assert.equal(h.confirmed[0], `前缀{(@user/${aliceId})} `)
  h.call("changeCaption", h.caption.replace("阿丽", "别人"))
  h.call("confirm")
  assert.equal(h.confirmed[1], "前缀@别人 ")
})

test("关闭或切换媒体清空提及身份，普通编辑和发送失败重试不清空", () => {
  let reset = "",
    dependencies = ""
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(dialog) === "useEffect") {
      reset = node.arguments[0].getText(dialog)
      dependencies = node.arguments[1].getText(dialog)
    }
    ts.forEachChild(node, visit)
  }
  visit(dialog)
  assert.equal(dependencies, "[open, resourceUrl]")
  const h = harness()
  h.call("insertCandidate", candidates[0])
  h.call("confirm")
  h.call("confirm")
  assert.deepEqual(h.confirmed, ["{(@user/all)} ", "{(@user/all)} "])
  const compiled = ts.transpileModule(`const reset = ${reset}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const scope = h.scope()
  new Function(...Object.keys(scope), `${compiled}; reset();`)(...Object.values(scope))
  h.call("confirm")
  assert.equal(h.confirmed[2], "@所有人 ")
})

test("媒体候选绑定实际发送会话，而非切换后的当前会话，并支持临时话题", () => {
  const chat = source("../src/renderer/features/chat/chat-page.tsx")
  const a = group()
  assert.ok(a.members)
  const b = { ...group("group-b"), members: a.members.filter((member) => member.id === bobId) }
  function scope(selected: DesktopConversation) {
    return {
      selected,
      conversations: [a, b],
      resolveMentionLabel: () => undefined,
      pendingImage: { conversationId: a.id },
      pendingVideo: { conversationId: b.id },
      createMentionCandidates,
    }
  }
  const result = callback(chat, "mediaMentionCandidates", scope(b))()
  assert.ok(result.image.some((candidate: MentionCandidate) => candidate.id === aliceId))
  assert.equal(
    result.video.some((candidate: MentionCandidate) => candidate.id === aliceId),
    false,
  )
  const topic = {
    id: "temporary-topic",
    type: "topic",
    members: [],
    topic: { parentConversationId: a.id, parentConversationType: "group" },
  } as unknown as DesktopConversation
  const temporary = callback(chat, "mediaMentionCandidates", {
    ...scope(topic),
    pendingImage: { conversationId: topic.id },
  })()
  assert.ok(temporary.image.some((candidate: MentionCandidate) => candidate.id === aliceId))
})

test("图片和视频发送链路传递序列化说明，并保留待发送会话及回复目标", async () => {
  const sender = source("../src/renderer/features/chat/hooks/use-attachment-sender.ts")
  for (const category of ["Image", "Video"]) {
    const requests: Record<string, unknown>[] = []
    const scope = {
      window: {
        desktop: {
          accountData: {
            sendImageMessage: async (input: Record<string, unknown>) => {
              requests.push(input)
              return { ok: true, data: [] }
            },
            sendVideoMessage: async (input: Record<string, unknown>) => {
              requests.push(input)
              return { ok: true, data: [] }
            },
          },
        },
      },
      targetId: "account",
      mediaCaption: "不应发送原始显示文字",
      sendingMedia: null,
      replyToMessageId: "reply",
      pendingImage: {
        conversationId: "original-group",
        selected: { token: "selection" },
        prepared: {
          blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
          name: "image.png",
          width: 1,
          height: 1,
        },
      },
      pendingVideo: { conversationId: "original-group", selected: { token: "selection" } },
      setSendingMedia: () => {},
      showToast: () => {},
      onMessages: () => {},
      onReplyConsumed: () => {},
      clearPendingImage: () => {},
      focusComposer: () => {},
      setPendingVideo: () => {},
      setMediaCaption: () => {},
    }
    const caption = `{(@user/${aliceId})} 看看这张图片`
    await callback(sender, `sendPending${category}`, scope)(caption)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].caption, caption)
    assert.equal(requests[0].conversationId, "original-group")
    assert.equal(requests[0].replyToMessageId, "reply")
  }
})
