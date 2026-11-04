import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { AuthFailure, isRecord } from "../src/shared/auth.ts"
import type { AccountDataChangedEvent, MessageSendFailure } from "../src/shared/account-data.ts"
import { messageSendErrorMessage } from "../src/main/account/message-send-error.ts"

const require = createRequire(import.meta.url)
const sourceRoot = path.resolve(import.meta.dirname, "../src")
const runtimeFile = "main/account/account-runtime.ts"
const hookFile = "renderer/features/chat/hooks/use-chat-data.ts"
const parse = (file: string) => {
  const fullPath = path.join(sourceRoot, file)
  return ts.createSourceFile(fullPath, readFileSync(fullPath, "utf8"), ts.ScriptTarget.Latest, true)
}

function method(file: string, name: string): Function {
  const source = parse(file)
  let body = ""
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === name)
      body = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body, name)
  const code = ts.transpileModule(`class Runtime { ${body} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function("AuthFailure", `${code}; return Runtime.prototype.${name};`)(AuthFailure)
}

function callback(name: string, scope: Record<string, any>): Function {
  const source = parse(hookFile)
  let body = ""
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      body = node.initializer.arguments[0].getText(source)
    }
    if (
      name === "changed" &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect"
    ) {
      const text = node.arguments[0]?.getText(source) ?? ""
      if (text.includes("accountData.onChanged(")) body = text
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body, name)
  const code = ts.transpileModule(`const callback = ${body}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(scope), `${code}; return callback;`)(...Object.values(scope))
}

function runtimePublisher(emit: (event: AccountDataChangedEvent) => void) {
  const runtime = {
    revision: 0,
    input: { targetId: "account", onDataChanged: emit },
    notifyChanged: method(runtimeFile, "notifyChanged"),
  }
  const source = parse(runtimeFile)
  let body = ""
  function visit(node: ts.Node) {
    if (ts.isNewExpression(node) && node.expression.getText(source) === "ConversationManager") {
      body = node.arguments![4].getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body)
  const code = ts.transpileModule(`const callback = ${body}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(`return function () { ${code}; return callback; }`)().call(runtime)
}

function renderer(selectedId = "room") {
  const toasts: Array<{ status: string; title: string; description?: string }> = []
  let listener: ((event: AccountDataChangedEvent) => void) | undefined
  const scope: Record<string, any> = {
    targetId: "account",
    selectedId,
    selectedIdRef: { current: selectedId },
    realtimeRevisionRef: { current: 0 },
    realtimeTargetRef: { current: "account" },
    scrollToBottomRef: { current: false },
    setConversationRevision: () => {},
    setMessageRevision: () => {},
    setContactRevision: () => {},
    setMessages: () => {},
    retainMessageWindow: (messages: unknown) => messages,
    showToast: (toast: (typeof toasts)[number]) => toasts.push(toast),
    window: {
      desktop: {
        accountData: {
          onChanged: (fn: typeof listener) => {
            listener = fn
            return () => {
              listener = undefined
            }
          },
        } as Record<string, any>,
      },
    },
  }
  const cleanup = callback("changed", scope)()
  return { scope, toasts, cleanup, emit: (event: AccountDataChangedEvent) => listener?.(event) }
}

function outgoing(emit: (event: AccountDataChangedEvent) => void = () => {}) {
  const events: AccountDataChangedEvent[] = []
  const rows = new Map<string, Record<string, any>>()
  const requests: string[] = []
  let statusError = false
  let reply: () => Promise<unknown> = async () => {
    throw new AuthFailure("network", "private-error")
  }
  const add = (input: Record<string, any>, bodyType: string) => {
    rows.set(input.clientMessageId, {
      ...input,
      bodyType,
      id: input.clientMessageId,
      deliveryStatus: "sending",
    })
  }
  const database = {
    createOptimisticMessage: (input: Record<string, any>) => add(input, input.bodyType),
    createOptimisticFileMessage: (input: Record<string, any>) => add(input, "file"),
    createOptimisticImageMessage: (input: Record<string, any>) => add(input, "image"),
    createOptimisticVideoMessage: (input: Record<string, any>) => add(input, "video"),
    listMessages: (id: string) => [...rows.values()].filter((row) => row.conversationId === id),
    getOutgoingMessage: (_id: string, clientMessageId: string) => rows.get(clientMessageId),
    setOutgoingMessageStatus: (_id: string, clientMessageId: string, status: string) => {
      if (statusError) throw new Error("private-database-path")
      const row = rows.get(clientMessageId)
      if (!row?.deliveryStatus) return false
      row.deliveryStatus = status
      return true
    },
    upsertMessages: (messages: Array<Record<string, any>>) => {
      for (const message of messages) rows.get(message.clientMessageId)!.deliveryStatus = undefined
    },
  }
  const request = (_endpoint: string, body: Record<string, any>) => {
    requests.push(body.client_message_id)
    return reply()
  }
  const exports: Record<string, any> = {}
  const code = ts.transpileModule(
    readFileSync(path.join(sourceRoot, "main/account/outgoing-message-service.ts"), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    },
  ).outputText
  runInNewContext(code, {
    exports,
    setTimeout,
    Error,
    require: (name: string) => {
      if (name.startsWith("node:")) return require(name)
      if (name === "../../shared/auth") return { AuthFailure, isRecord }
      if (name === "../../shared/message-link")
        return { normalizeSingleLinkMessageURL: (value: string) => value }
      if (name === "./conversation-parser") return { parseMessage: (value: unknown) => value }
      if (name === "./outgoing-message-payload")
        return {
          createOutgoingTextMessageRequest: (value: { clientMessageId: string }) => ({
            client_message_id: value.clientMessageId,
          }),
        }
      if (name === "./message-send-error") return { messageSendErrorMessage }
      if (name === "../local-file-response") return {}
      throw new Error(`未配置依赖 ${name}`)
    },
  })
  const publish = runtimePublisher((event) => {
    events.push(structuredClone(event))
    emit(event)
  })
  const service = new exports.OutgoingMessageService(
    database,
    { post: request, postFile: request },
    "me",
    "我",
    publish,
  )
  return {
    service,
    events,
    rows,
    requests,
    failWith: (error: unknown) => {
      reply = async () => {
        throw error
      }
    },
    succeed: () => {
      reply = async () => ({ message: { clientMessageId: requests.at(-1) } })
    },
    failStatusWrite: () => {
      statusError = true
    },
    respond: (value: unknown) => {
      reply = async () => value
    },
    send(kind: string) {
      const file = { path: "/unused/attachment", name: "attachment", sizeBytes: 10 }
      if (kind === "file") return service.sendFileMessage("room", file)
      if (kind === "image")
        return service.sendImageMessage("room", {
          ...file,
          contentType: "image/png",
          width: 1,
          height: 1,
          caption: "",
        })
      if (kind === "video")
        return service.sendVideoMessage("room", { ...file, contentType: "video/mp4", caption: "" })
      return service.sendTextMessage("room", "消息", kind)
    },
  }
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

for (const [code, expected] of [
  ["network", "网络连接异常"],
  ["timeout", "发送超时"],
  ["http_504", "发送超时"],
  ["unauthorized", "登录状态已失效"],
  ["not_authenticated", "登录状态已失效"],
  ["invalid_session", "登录状态已失效"],
  ["expired_session", "登录状态已失效"],
  ["forbidden", "没有发送权限"],
  ["direct_friendship_required", "添加对方为好友"],
  ["direct_message_unavailable", "无法接收"],
  ["not_found", "会话或消息已不可用"],
  ["conflict", "消息状态已变化"],
  ["rate_limited", "发送过于频繁"],
  ["request_too_large", "超出大小限制"],
  ["invalid_reply_message", "内容或引用"],
  ["invalid_image", "附件无法读取"],
  ["file_unavailable", "附件无法读取"],
  ["invalid_response", "服务端响应异常"],
  ["response_too_large", "服务端响应异常"],
  ["internal_error", "服务端暂时不可用"],
  ["http_503", "服务端暂时不可用"],
  ["ERR_SQLITE_ERROR", "本地消息保存异常"],
  ["account_not_ready", "账号尚未就绪"],
  ["unknown", "未知错误"],
]) {
  test(`发送失败原因归类：${code}，不展示原始报错`, () => {
    const result = messageSendErrorMessage(new AuthFailure(code, "private-token-and-server-path"))
    assert.ok(result.includes(expected))
    assert.ok(!result.includes("private"))
  })
}

for (const kind of ["text", "markdown", "link", "file", "image", "video"]) {
  test(`${kind}后台失败经过Runtime事件只弹一次Toast，并保留失败消息`, async (t) => {
    const ui = renderer()
    t.after(ui.cleanup)
    const f = outgoing(ui.emit)
    f.failWith(new AuthFailure("timeout", "private-server-details"))
    f.send(kind)
    assert.equal([...f.rows.values()][0].deliveryStatus, "sending")
    await settle()
    assert.equal([...f.rows.values()][0].deliveryStatus, "failed")
    const failure = f.events.find((event) => event.messageSendFailure)!
    assert.equal(failure.targetId, "account")
    assert.equal(failure.messageSendFailure?.conversationId, "room")
    assert.equal(failure.messageSendFailure?.clientMessageId, f.requests[0])
    assert.equal(ui.toasts.length, 1)
    assert.equal(ui.toasts[0].title, "发送消息失败")
    assert.match(ui.toasts[0].description!, /发送超时/)
    assert.ok(!JSON.stringify(f.events).includes("private"))
    ui.emit(failure)
    assert.equal(ui.toasts.length, 1, "重放同一事件不能重复提示")
  })
}

test("文本发送IPC已成功但后台失败，只弹一次；重试再次失败再提示一次", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  const rpc = async (run: () => unknown) => {
    try {
      return { ok: true, data: run() }
    } catch (error) {
      return { ok: false, error }
    }
  }
  ui.scope.window.desktop.accountData.sendTextMessage = (input: any) =>
    rpc(() => f.service.sendTextMessage(input.conversationId, input.content, input.bodyType))
  ui.scope.window.desktop.accountData.retryMessage = (input: any) =>
    rpc(() => f.service.retryMessage(input.conversationId, input.clientMessageId))
  callback("sendTextMessage", ui.scope)("消息", "text")
  await settle()
  assert.equal(ui.toasts.length, 1)
  const row = [...f.rows.values()][0]
  callback("retryMessage", ui.scope)(row)
  await settle()
  assert.equal(ui.toasts.length, 2)
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[0], f.requests[1], "重试应沿用同一消息ID")
})

test("前置校验失败仍走原IPC Toast，不广播异步失败而重复提示", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  ui.scope.window.desktop.accountData.sendTextMessage = async () => {
    try {
      return { ok: true, data: f.service.sendTextMessage("room", " ", "text") }
    } catch (error) {
      return { ok: false, error }
    }
  }
  callback("sendTextMessage", ui.scope)(" ", "text")
  await settle()
  assert.equal(ui.toasts.length, 1)
  assert.equal(f.events.length, 0)
  assert.equal(f.requests.length, 0)
})

test("成功发送不弹失败Toast", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  f.succeed()
  f.send("text")
  await settle()
  assert.equal(ui.toasts.length, 0)
  assert.equal([...f.rows.values()][0].deliveryStatus, undefined)
})

test("切换会话后，本账号刚发送的消息失败仍有提示", async (t) => {
  const ui = renderer("another-room")
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  f.send("text")
  await settle()
  assert.equal(ui.toasts.length, 1)
})

test("切换账号后旧订阅不再弹出原账号的失败提示", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  ui.scope.realtimeTargetRef.current = "another-account"
  f.send("text")
  await settle()
  assert.equal(ui.toasts.length, 0)
})

test("其他账号事件和历史失败快照不弹Toast", (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const failure: MessageSendFailure = {
    conversationId: "room",
    clientMessageId: "m1",
    message: "网络连接异常",
  }
  ui.emit({
    targetId: "another-account",
    revision: 1,
    domains: ["messages"],
    conversationIds: ["room"],
    messageSendFailure: failure,
  })
  ui.emit({ targetId: "account", revision: 2, domains: ["messages"], conversationIds: ["room"] })
  assert.equal(ui.toasts.length, 0)
})

test("已有实时确认或运行时已关闭时，不误报后台发送失败", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const acknowledged = outgoing(ui.emit)
  acknowledged.send("text")
  ;[...acknowledged.rows.values()][0].deliveryStatus = undefined
  const closed = outgoing(ui.emit)
  closed.send("text")
  closed.service.close()
  await settle()
  assert.equal(ui.toasts.length, 0)
})

test("失败状态保存异常也能安全提示，不暴露本地路径", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  f.send("text")
  f.failStatusWrite()
  await settle()
  assert.equal(ui.toasts.length, 1)
  assert.match(ui.toasts[0].description!, /本地消息状态保存失败/)
  assert.ok(!JSON.stringify(f.events).includes("private"))
})

function authenticated(fetch: (...args: any[]) => Promise<Response>, readable = true) {
  const exports: Record<string, any> = {}
  const code = ts.transpileModule(
    readFileSync(path.join(sourceRoot, "main/account/authenticated-client.ts"), "utf8"),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    },
  ).outputText
  runInNewContext(code, {
    exports,
    Error,
    Blob,
    FormData,
    AbortSignal,
    TextDecoder,
    Uint8Array,
    URL,
    require: (name: string) => {
      if (name === "../../shared/auth") return { AuthFailure, isRecord }
      if (name === "node:fs")
        return {
          openAsBlob: async () => {
            if (!readable) throw new Error("private-local-path")
            return new Blob(["file"])
          },
        }
      if (name === "./avatar-content-type") return {}
      throw new Error(name)
    },
  })
  return new exports.AuthenticatedClient("https://example.test", { fetch }, "test-token")
}

for (const attachment of [false, true]) {
  test(`真实请求超时保留独立错误类别，附件=${attachment}`, async () => {
    const error = new Error("private-timeout-details")
    error.name = "TimeoutError"
    const client = authenticated(async () => {
      throw error
    })
    const request = attachment
      ? client.postFile(
          "/api/client/conversations/room/messages/files",
          {},
          { path: "/unused", name: "file" },
        )
      : client.post("/api/client/conversations/room/messages", {})
    await assert.rejects(
      request,
      (failure: unknown) => failure instanceof AuthFailure && failure.code === "timeout",
    )
  })
}

test("附件读取失败与网络错误区分，不泄露文件路径", async () => {
  let requests = 0
  const client = authenticated(async () => {
    requests++
    throw new Error("不可请求")
  }, false)
  await assert.rejects(
    client.postFile(
      "/api/client/conversations/room/messages/files",
      {},
      { path: "/unused", name: "file" },
    ),
    (failure: unknown) =>
      failure instanceof AuthFailure &&
      failure.code === "file_unavailable" &&
      !failure.message.includes("private"),
  )
  assert.equal(requests, 0)
})

for (const code of ["network", "timeout"]) {
  test(`补读最新消息遇到${code}时仍返回本地缓存`, async () => {
    const cached = [{ id: "cached" }]
    const runtime = {
      assertInitialized() {},
      conversationManager: {
        ensureLatestOnOpen: async () => {
          throw new AuthFailure(code, "请求未完成")
        },
        listMessages: (conversationId: string, limit: number) => {
          assert.equal(conversationId, "room")
          assert.equal(limit, 50)
          return cached
        },
      },
    }
    assert.equal(await method(runtimeFile, "listMessages").call(runtime, "room", 50), cached)
  })
}

test("补读最新消息的权限错误不能被当成网络问题吞掉", async () => {
  const runtime = {
    assertInitialized() {},
    conversationManager: {
      ensureLatestOnOpen: async () => {
        throw new AuthFailure("forbidden", "权限不足")
      },
      listMessages: () => assert.fail("不能忽略权限错误"),
    },
  }
  await assert.rejects(
    method(runtimeFile, "listMessages").call(runtime, "room", 50),
    (error: unknown) => error instanceof AuthFailure && error.code === "forbidden",
  )
})

test("服务端缺少消息响应也会提示明确原因", async (t) => {
  const ui = renderer()
  t.after(ui.cleanup)
  const f = outgoing(ui.emit)
  f.respond({})
  f.send("text")
  await settle()
  assert.equal(ui.toasts.length, 1)
  assert.match(ui.toasts[0].description!, /服务端响应异常/)
})

test("普通网络错误与服务端错误码保留给失败分类", async () => {
  const disconnected = authenticated(async () => {
    throw new Error("private-network-details")
  })
  await assert.rejects(
    disconnected.post("/api/client/conversations/room/messages", {}),
    (failure: unknown) => failure instanceof AuthFailure && failure.code === "network",
  )
  const forbidden = authenticated(
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "forbidden", message: "private-server-details" },
        }),
        { status: 403 },
      ),
  )
  await assert.rejects(
    forbidden.post("/api/client/conversations/room/messages", {}),
    (failure: unknown) =>
      failure instanceof AuthFailure && messageSendErrorMessage(failure).includes("没有发送权限"),
  )
})
