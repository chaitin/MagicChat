import { Platform } from "react-native"

import { DATABASE_VERSION } from "@/data/database/database-version"
import { emitDatabaseTelemetry } from "@/data/database/database-telemetry"
import { createDatabaseMigrationSQL } from "@/data/database/migrations"
import {
  createDatabaseService,
  type DatabaseAdapter,
  type DatabaseBindArguments,
  type DatabaseBindParams,
  type DatabaseOperationMetric,
  type DatabaseReader,
  type DatabaseRunResult,
  type DatabaseWriter,
  type MaintenanceDatabase,
} from "@/data/database/database-service-core"

const DATABASE_NAME = "magicchat-messages-v1.db"

function createWebAdapter(): DatabaseAdapter {
  const reader: DatabaseReader = {
    async getFirst() { return null },
    async getAll() { return [] },
  }
  const writer: DatabaseWriter = {
    ...reader,
    async run(): Promise<DatabaseRunResult> { return { changes: 0, lastInsertRowId: 0 } },
  }
  const maintenance: MaintenanceDatabase = {
    ...writer,
    async exec() {},
    async transaction(operation) { return operation(maintenance) },
  }
  return {
    reader,
    writer,
    maintenance,
    async transaction(operation) { return operation(writer) },
    async close() {},
  }
}

async function openNativeAdapter(): Promise<DatabaseAdapter> {
  const { openDatabaseAsync } = await import("expo-sqlite")
  const database = await openDatabaseAsync(DATABASE_NAME)
  try {
    await database.execAsync("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")
    const bind = (params: DatabaseBindArguments): DatabaseBindParams =>
      params.length === 1 && (Array.isArray(params[0]) || (typeof params[0] === "object" && !(params[0] instanceof Uint8Array)))
        ? params[0] as DatabaseBindParams
        : params as DatabaseBindParams
    const narrow = (target: typeof database): MaintenanceDatabase => ({
      getFirst: <T>(sql: string, ...params: DatabaseBindArguments) => target.getFirstAsync<T>(sql, bind(params)),
      getAll: <T>(sql: string, ...params: DatabaseBindArguments) => target.getAllAsync<T>(sql, bind(params)),
      run: (sql: string, ...params: DatabaseBindArguments) => target.runAsync(sql, bind(params)),
      exec: (sql: string) => target.execAsync(sql),
      transaction: async <T>(operation: (transaction: MaintenanceDatabase) => Promise<T>) => {
        let result!: T
        await database.withExclusiveTransactionAsync(async (transaction) => {
          result = await operation(narrow(transaction))
        })
        return result
      },
    })
    const access = narrow(database)
    return {
      reader: access,
      writer: access,
      maintenance: access,
      transaction: async <T>(operation: (transaction: DatabaseWriter) => Promise<T>) => {
        let result!: T
        await database.withExclusiveTransactionAsync(async (transaction) => {
          result = await operation(narrow(transaction))
        })
        return result
      },
      close: () => database.closeAsync(),
    }
  } catch (error) {
    await database.closeAsync().catch(() => undefined)
    throw error
  }
}

function observeDatabaseOperation(metric: DatabaseOperationMetric) {
  emitDatabaseTelemetry({
    operation: metric.name,
    kind: metric.kind,
    queueDurationMs: metric.queueDurationMs,
    executionDurationMs: metric.executionDurationMs,
    ...(metric.errorCategory ? { errorCategory: metric.errorCategory } : {}),
  })
}

export const isDatabasePersistenceAvailable = Platform.OS !== "web"

export const databaseService = createDatabaseService({
  open: () => Platform.OS === "web" ? Promise.resolve(createWebAdapter()) : openNativeAdapter(),
  initialize: {
    name: "database.migration",
    operation: async (database) => {
      const version = await database.getFirst<{ user_version: number }>("PRAGMA user_version")
      const previousVersion = version?.user_version ?? 0
      if (previousVersion >= DATABASE_VERSION) return
      await database.transaction((transaction) =>
        transaction.exec(createDatabaseMigrationSQL(previousVersion))
      )
    },
  },
  observe: observeDatabaseOperation,
})

export { classifyDatabaseError } from "@/data/database/database-service-core"

export type {
  DatabaseReader,
  DatabaseService,
  DatabaseWriter,
  MaintenanceDatabase,
  DatabaseOperationMetric,
} from "@/data/database/database-service-core"
