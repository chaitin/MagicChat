import assert from "node:assert/strict"
import test from "node:test"

import {
  createDatabaseService,
  DatabaseTransactionReentryError,
  type DatabaseAdapter,
  type DatabaseReader,
  type DatabaseWriter,
  type MaintenanceDatabase,
} from "@/data/database/database-service-core"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function fakeAdapter(): DatabaseAdapter {
  const reader: DatabaseReader = { async getFirst() { return null }, async getAll() { return [] } }
  const writer: DatabaseWriter = {
    ...reader,
    async run() { return { changes: 0, lastInsertRowId: 0 } },
  }
  const maintenance: MaintenanceDatabase = {
    ...writer,
    async exec() {},
    async transaction(operation) { return operation(writer) },
  }
  return {
    reader, writer, maintenance,
    async transaction(operation) { return operation(writer) },
    async close() {},
  }
}

test("writer actor is FIFO and writer callbacks never overlap", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  const events: string[] = []
  let active = 0
  let maximum = 0
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const first = service.write("first", async () => {
    active += 1; maximum = Math.max(maximum, active); events.push("first:start")
    await blocked
    events.push("first:end"); active -= 1
  })
  const second = service.write("second", async () => {
    active += 1; maximum = Math.max(maximum, active); events.push("second"); active -= 1
  })
  await tick()
  assert.deepEqual(events, ["first:start"])
  release()
  await Promise.all([first, second])
  assert.deepEqual(events, ["first:start", "first:end", "second"])
  assert.equal(maximum, 1)
})

test("writer actor continues and records classified timings after failure", async () => {
  let clock = 0
  const metrics: unknown[] = []
  const service = createDatabaseService({
    open: async () => fakeAdapter(),
    now: () => ++clock,
    observe: (metric) => metrics.push(metric),
  })
  const failed = service.write("failed-write", async () => { throw new Error("SQLITE_BUSY: database is locked") })
  const recovered = service.write("recovered-write", async () => 42)
  await assert.rejects(failed, /locked/)
  assert.equal(await recovered, 42)
  assert.deepEqual(metrics, [
    { name: "failed-write", kind: "write", queueDurationMs: 2, executionDurationMs: 1, errorCategory: "busy" },
    { name: "recovered-write", kind: "write", queueDurationMs: 3, executionDurationMs: 1 },
  ])
  assert.equal(JSON.stringify(metrics).includes("SQLITE_BUSY"), false)
})

test("maintenance drains active reads and blocks subsequently admitted reads", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  const events: string[] = []
  let releaseRead!: () => void
  let releaseMaintenance!: () => void
  const readBlocked = new Promise<void>((resolve) => { releaseRead = resolve })
  const maintenanceBlocked = new Promise<void>((resolve) => { releaseMaintenance = resolve })
  const read = service.read("active-read", async () => { events.push("read:start"); await readBlocked; events.push("read:end") })
  await tick()
  const maintenance = service.maintenance("checkpoint", async () => {
    events.push("maintenance:start"); await maintenanceBlocked; events.push("maintenance:end")
  })
  const laterRead = service.read("later-read", async () => { events.push("later-read") })
  await tick()
  assert.deepEqual(events, ["read:start"])
  releaseRead()
  await read
  await tick()
  assert.deepEqual(events, ["read:start", "read:end", "maintenance:start"])
  releaseMaintenance()
  await Promise.all([maintenance, laterRead])
  assert.deepEqual(events, ["read:start", "read:end", "maintenance:start", "maintenance:end", "later-read"])
})

test("failed maintenance releases its barrier and the writer recovers", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  await assert.rejects(
    service.maintenance("messages.optimize", async () => { throw new Error("checkpoint failed") }),
    /checkpoint failed/
  )
  assert.equal(await service.read("messages.after-maintenance.read", async () => 1), 1)
  assert.equal(await service.write("messages.after-maintenance.write", async () => 2), 2)
})

test("writes submitted by different stores share one writer", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  let active = 0
  let maximum = 0
  const storeWrite = (name: string) => service.write(name, async () => {
    active += 1
    maximum = Math.max(maximum, active)
    await tick()
    active -= 1
  })

  await Promise.all([
    storeWrite("projects.page.write"),
    storeWrite("contacts.directory.replace"),
    storeWrite("conversations.tombstone"),
  ])
  assert.equal(maximum, 1)
})

test("adapter transaction failure rolls back all store writes", async () => {
  const values: string[] = []
  const adapter = fakeAdapter()
  adapter.transaction = async (operation) => {
    const staged: string[] = []
    const transaction: DatabaseWriter = {
      ...adapter.writer,
      async run(_sql, params = []) {
        if (Array.isArray(params) && typeof params[0] === "string") staged.push(params[0])
        return { changes: 1, lastInsertRowId: 0 }
      },
    }
    const result = await operation(transaction)
    values.push(...staged)
    return result
  }
  const service = createDatabaseService({ open: async () => adapter })

  await assert.rejects(service.transaction("contacts.profiles.merge", async (tx) => {
    await tx.run("INSERT project", ["project"])
    await tx.run("INSERT contact", ["contact"])
    throw new Error("store write failed")
  }), /store write failed/)
  assert.deepEqual(values, [])

  await service.transaction("conversations.patch", async (tx) => {
    await tx.run("UPDATE conversation", ["conversation"])
  })
  assert.deepEqual(values, ["conversation"])
})

test("independent operations submitted while a transaction is awaiting queue normally", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  const events: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const transaction = service.transaction("transaction", async () => {
    events.push("transaction:start")
    await blocked
    events.push("transaction:end")
  })
  await tick()
  const independent = service.write("independent", async () => { events.push("independent") })
  await tick()
  assert.deepEqual(events, ["transaction:start"])
  release()
  await Promise.all([transaction, independent])
  assert.deepEqual(events, ["transaction:start", "transaction:end", "independent"])
})

test("failed initialization closes the adapter and a later operation retries open", async () => {
  const original = new Error("migration failed")
  let opens = 0
  let closes = 0
  const service = createDatabaseService({
    open: async () => {
      opens += 1
      const adapter = fakeAdapter()
      adapter.close = async () => {
        closes += 1
        if (opens === 1) throw new Error("close failed")
      }
      return adapter
    },
    initialize: {
      name: "initialize",
      operation: async () => {
        if (opens === 1) throw original
      },
    },
  })

  await assert.rejects(service.read("first", async () => undefined), (error) => error === original)
  assert.equal(closes, 1)
  await service.read("retry", async () => undefined)
  assert.equal(opens, 2)
})

test("top-level transaction operations fail fast when reentered", async () => {
  const service = createDatabaseService({ open: async () => fakeAdapter() })
  await service.transaction("outer", async () => {
    assert.throws(() => service.write("nested-write", async () => undefined), DatabaseTransactionReentryError)
    assert.throws(() => service.transaction("nested-transaction", async () => undefined), DatabaseTransactionReentryError)
    assert.throws(() => service.maintenance("nested-maintenance", async () => undefined), DatabaseTransactionReentryError)
  })
  assert.equal(await service.write("after-transaction", async () => 7), 7)
})
