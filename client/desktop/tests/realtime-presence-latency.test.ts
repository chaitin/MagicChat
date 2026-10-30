import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { WebSocketServer, type WebSocket } from "ws"
import ts from "typescript"
import { AuthFailure, isRecord } from "../src/shared/auth.ts"
import type { RealtimeEvent } from "../src/main/account/realtime-manager.ts"

async function fixture(blockDurable = false) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  let finishEvent!: () => void
  const eventBarrier = new Promise<void>((resolve) => {
    finishEvent = resolve
  })
  const statuses: RealtimeEvent[] = []
  const durable: RealtimeEvent[] = []
  const states: string[] = []
  const exported: Record<string, any> = {}
  const source = readFileSync(
    new URL("../src/main/account/realtime-manager.ts", import.meta.url),
    "utf8",
  )
  const require = createRequire(import.meta.url)
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: exported,
      Buffer,
      URL,
      setTimeout,
      clearTimeout,
      require: (name: string) =>
        name === "node:crypto"
          ? { randomUUID }
          : name === "ws"
            ? require("ws")
            : { AuthFailure, isRecord },
    },
  )
  const manager = new exported.RealtimeManager({
    serverUrl: `http://127.0.0.1:${address.port}`,
    token: "local-fixture-token",
    synchronize: () => barrier,
    applyPresenceEvent: (event: RealtimeEvent) => {
      statuses.push(event)
    },
    applyEvent: async (event: RealtimeEvent) => {
      durable.push(event)
      if (blockDurable) await eventBarrier
    },
    onStateChange: (state: string) => states.push(state),
  })
  const connected = once(server, "connection")
  const online: Promise<void> = manager.start()
  void online.catch(() => undefined)
  const [socket] = (await connected) as [WebSocket]
  let seq = 0
  const send = async (event: string, payload: unknown = {}) => {
    socket.send(JSON.stringify({ v: 1, kind: "event", id: `e${++seq}`, event, payload }))
    // Pong确认前一帧已经过客户端消息处理，不靠延时猜测事件是否到达。
    const ack = once(socket, "pong")
    socket.ping("processed")
    await ack
  }
  return {
    statuses,
    durable,
    states,
    send,
    async release() {
      finish()
      await online
    },
    async close() {
      finish()
      finishEvent()
      manager.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

const sender = { type: "app", id: "app" }
const status = { conversation_id: "room", status: "正在运行", sender }
const message = { message: { conversation_id: "room", id: "reply", sender } }

test("真实WS：后台补同步未结束，Header状态必须立即分发", { timeout: 3000 }, async (t) => {
  const h = await fixture()
  t.after(h.close)
  await h.send("system.ready")
  assert.deepEqual(h.states, ["loading"])
  await h.send("conversation.status", status)
  assert.deepEqual(
    h.statuses.map((event) => event.name),
    ["conversation.status"],
    "状态不能排队等待全量同步",
  )
  assert.equal(h.durable.length, 0)
  await h.release()
  assert.equal(h.durable.length, 0, "短时状态不能在同步后再次回放")
})

test("真实WS：回复到达立即清理Header状态，不等消息落库队列", { timeout: 3000 }, async (t) => {
  const h = await fixture()
  t.after(h.close)
  await h.send("system.ready")
  await h.send("conversation.status", status)
  await h.send("message.created", message)
  assert.deepEqual(
    h.statuses.map((event) => event.name),
    ["conversation.status", "message.created"],
  )
  assert.equal(h.durable.length, 0, "历史数据同步屏障保持不变")
  await h.release()
  assert.deepEqual(
    h.durable.map((event) => event.name),
    ["message.created"],
  )
  assert.equal(h.statuses.length, 2, "落库时不能重复回放状态")
})

test(
  "真实WS：连接已ready但数据事件处理阻塞时，Header状态仍即时分发",
  { timeout: 3000 },
  async (t) => {
    const h = await fixture(true)
    t.after(h.close)
    await h.send("system.ready")
    await h.release()
    await h.send("conversation.updated", { conversation_id: "room" })
    assert.equal(h.durable.length, 1)
    await h.send("conversation.status", status)
    await h.send("message.created", message)
    assert.deepEqual(
      h.statuses.map((event) => event.name),
      ["conversation.status", "message.created"],
    )
    assert.equal(h.durable.length, 1, "数据队列暂停时，状态和清理帧仍不能等待它")
  },
)

test("真实WS：同步期间状态心跳不占历史消息缓冲队列", { timeout: 5000 }, async (t) => {
  const h = await fixture()
  t.after(h.close)
  await h.send("system.ready")
  for (let count = 0; count < 1001; count++) await h.send("conversation.status", status)
  assert.equal(h.statuses.length, 1001)
  await h.release()
  assert.equal(h.durable.length, 0)
  assert.deepEqual(h.states, ["loading", "ready"])
})
