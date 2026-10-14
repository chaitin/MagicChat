import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { DatabaseSync } from "node:sqlite"
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

const { parseConversation } = await import("../src/main/account/conversation-parser.ts")
const { initializeAccountSchema } = await import("../src/main/account/database/account-schema.ts")
const { ConversationRepository } =
  await import("../src/main/account/database/conversation-repository.ts")

const self = { type: "user", id: "self", name: "我" }
const peer = { type: "user", id: "peer", name: "对方" }
const assistant = { type: "app", id: "00000000-0000-0000-0000-000000000001", name: "茉莉" }
const input = {
  id: "direct-1",
  type: "direct",
  name: "对方",
  created_at: "2026-10-14T00:00:00Z",
}

function avatarIdentity(
  value: Pick<ReturnType<typeof parseConversation>, "avatarType" | "avatarId">,
) {
  return { type: value.avatarType, id: value.avatarId }
}

test("私聊头像始终选择对方用户，不受茉莉成员排列顺序影响", () => {
  const orders = [
    [self, peer, assistant],
    [self, assistant, peer],
    [peer, self, assistant],
    [peer, assistant, self],
    [assistant, self, peer],
    [assistant, peer, self],
  ]
  for (const members of orders) {
    const parsed = parseConversation({ ...input, members }, self.id)
    assert.deepEqual(avatarIdentity(parsed), { type: "user", id: peer.id })
    assert.equal(parsed.isBuiltinAssistant, false)
  }
})

test("私聊缺少对方用户时不使用茉莉或其他应用冒充对方", () => {
  const parsed = parseConversation(
    {
      ...input,
      members: [assistant, self, { type: "app", id: "other-app", name: "其他应用" }],
    },
    self.id,
  )
  assert.deepEqual(avatarIdentity(parsed), { type: "group", id: input.id })
})

test("刷新私聊快照覆盖已保存的茉莉头像身份，无需清空数据库", () => {
  const database = new DatabaseSync(":memory:")
  try {
    initializeAccountSchema(database)
    const repository = new ConversationRepository(database)
    const parsed = parseConversation({ ...input, members: [assistant, self, peer] }, self.id)
    repository.upsertCurrent([{ ...parsed, avatarType: "app", avatarId: assistant.id }])
    repository.upsertCurrent([parsed])
    const stored = repository.list()[0]
    assert.equal(stored.type, "direct")
    assert.deepEqual(avatarIdentity(stored), { type: "user", id: peer.id })
  } finally {
    database.close()
  }
})
