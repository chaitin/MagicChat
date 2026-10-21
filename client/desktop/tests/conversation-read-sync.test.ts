import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import ts from "typescript"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
      )
        return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!url.endsWith(".ts")) return loaded
    return {
      ...loaded,
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(String(loaded.source), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    }
  },
})

const { AccountDatabase } = await import("../src/main/account/account-database.ts")
const { ConversationManager } = await import("../src/main/account/conversation-manager.ts")
const { ConversationReadSync } = await import("../src/main/account/conversation-read-sync.ts")
const { parseConversation } = await import("../src/main/account/conversation-parser.ts")
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}
const response = (seq: number) => ({ conversation_id: "room", last_read_seq: seq })

function database(file = ":memory:") {
  const db = new AccountDatabase(file)
  db.upsertCurrentConversations([
    parseConversation(
      {
        id: "room",
        type: "group",
        name: "Room",
        member_count: 2,
        avatar: "",
        created_at: "2026-01-01T00:00:00Z",
        last_message_summary: "",
        last_message_seq: 100,
        last_read_seq: 90,
        unread_count: 10,
      },
      "user",
    ),
  ])
  return db
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("消息已展示后的已读操作先落本地，不等待服务端响应", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database(),
    pending = deferred<unknown>()
  let calls = 0
  const manager = new ConversationManager(
    db,
    {
      post: async () => {
        calls++
        return pending.promise
      },
    } as never,
    "user",
    "User",
    () => undefined,
  )
  try {
    await manager.markRead("room", 100)
    assert.equal(db.listConversations()[0].unreadCount, 0)
    assert.equal(db.getConversationReadSeq("room"), 100)
    assert.deepEqual(
      db.listPendingConversationReads().map((read) => ({ ...read })),
      [{ conversationId: "room", upToSeq: 100 }],
    )
    t.mock.timers.tick(0)
    assert.equal(calls, 1)
    pending.resolve(response(100))
    await flush()
    assert.deepEqual(db.listPendingConversationReads(), [])
  } finally {
    manager.close()
    db.close()
  }
})

test("已读确认期间到达的新消息仍然保持未读，旧列表刷新不回退已读状态", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database(),
    pending = deferred<unknown>()
  const sync = new ConversationReadSync(
    db,
    { post: () => pending.promise } as never,
    () => undefined,
  )
  try {
    sync.enqueue("room", 100)
    t.mock.timers.tick(0)
    db.applyConversationMessageSeq("room", 101, false)
    db.upsertCurrentConversations([
      parseConversation(
        {
          id: "room",
          type: "group",
          name: "Room",
          member_count: 2,
          created_at: "2026-01-01T00:00:00Z",
          last_message_seq: 100,
          last_read_seq: 90,
          unread_count: 10,
        },
        "user",
      ),
    ])
    pending.resolve(response(100))
    await flush()
    assert.equal(db.getConversationReadSeq("room"), 100)
    assert.equal(db.listConversations()[0].unreadCount, 1)
  } finally {
    sync.close()
    db.close()
  }
})

test("网络失败后保留本地已读与待同步记录，并退避重试", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database()
  let calls = 0
  const sync = new ConversationReadSync(
    db,
    {
      post: async () => {
        calls++
        if (calls === 1) throw new Error("offline")
        return response(100)
      },
    } as never,
    () => undefined,
  )
  try {
    sync.enqueue("room", 100)
    t.mock.timers.tick(0)
    await flush()
    assert.equal(db.listConversations()[0].unreadCount, 0)
    assert.equal(db.listPendingConversationReads().length, 1)
    t.mock.timers.tick(999)
    assert.equal(calls, 1)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(calls, 2)
    assert.equal(db.listPendingConversationReads().length, 0)
  } finally {
    sync.close()
    db.close()
  }
})

test("较旧请求的响应不会删除期间合并的更新已读游标", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database(),
    pending = deferred<unknown>()
  const requested: number[] = []
  const sync = new ConversationReadSync(
    db,
    {
      post: async (_path: string, input: { up_to_seq: number }) => {
        requested.push(input.up_to_seq)
        return requested.length === 1 ? pending.promise : response(input.up_to_seq)
      },
    } as never,
    () => undefined,
  )
  try {
    sync.enqueue("room", 95)
    t.mock.timers.tick(0)
    sync.enqueue("room", 100)
    pending.resolve(response(95))
    await flush()
    assert.equal(db.getConversationReadSeq("room"), 100)
    assert.deepEqual(
      db.listPendingConversationReads().map((read) => ({ ...read })),
      [{ conversationId: "room", upToSeq: 100 }],
    )
    t.mock.timers.tick(0)
    await flush()
    assert.deepEqual(requested, [95, 100])
    assert.equal(db.listPendingConversationReads().length, 0)
  } finally {
    sync.close()
    db.close()
  }
})

test("退出账号后旧请求不再访问数据库或发出通知", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database(),
    pending = deferred<unknown>()
  let notifications = 0
  const sync = new ConversationReadSync(db, { post: () => pending.promise } as never, () => {
    notifications++
  })
  sync.enqueue("room", 100)
  t.mock.timers.tick(0)
  sync.close()
  db.close()
  pending.resolve(response(100))
  await flush()
  t.mock.timers.tick(60_000)
  assert.equal(notifications, 0)
})

test("重启后恢复持久化的已读同步任务，不因本地已读已推进而丢失", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const directory = mkdtempSync(join(tmpdir(), "conversation-read-"))
  const file = join(directory, "chat.sqlite")
  let db = database(file)
  db.queueConversationRead("room", 100)
  db.close()
  db = new AccountDatabase(file)
  let calls = 0
  const sync = new ConversationReadSync(
    db,
    {
      post: async () => {
        calls++
        return response(100)
      },
    } as never,
    () => undefined,
  )
  try {
    assert.equal(db.getConversationReadSeq("room"), 100)
    t.mock.timers.tick(0)
    await flush()
    assert.equal(calls, 1)
    assert.equal(db.listPendingConversationReads().length, 0)
  } finally {
    sync.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("无效响应不确认任务，关闭后取消重试定时器", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const db = database()
  let calls = 0
  const sync = new ConversationReadSync(
    db,
    {
      post: async () => {
        calls++
        return response(90)
      },
    } as never,
    () => undefined,
  )
  try {
    sync.enqueue("room", 100)
    t.mock.timers.tick(0)
    await flush()
    assert.equal(db.listPendingConversationReads().length, 1)
    sync.close()
    t.mock.timers.tick(60_000)
    assert.equal(calls, 1)
  } finally {
    sync.close()
    db.close()
  }
})
