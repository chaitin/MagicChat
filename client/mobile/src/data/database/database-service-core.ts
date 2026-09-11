export type DatabaseBindValue = string | number | null | boolean | Uint8Array
export type DatabaseBindParams = DatabaseBindValue[] | Record<string, DatabaseBindValue>

export interface DatabaseRunResult {
  lastInsertRowId: number
  changes: number
}

export type DatabaseBindArguments = [] | [DatabaseBindParams] | DatabaseBindValue[]

export interface DatabaseReader {
  getFirst<T>(sql: string, ...params: DatabaseBindArguments): Promise<T | null>
  getAll<T>(sql: string, ...params: DatabaseBindArguments): Promise<T[]>
}

export interface DatabaseWriter extends DatabaseReader {
  run(sql: string, ...params: DatabaseBindArguments): Promise<DatabaseRunResult>
}

export interface MaintenanceDatabase extends DatabaseWriter {
  exec(sql: string): Promise<void>
  transaction<T>(operation: (transaction: MaintenanceDatabase) => Promise<T>): Promise<T>
}

export type DatabaseOperationKind = "read" | "write" | "transaction" | "maintenance"
export type DatabaseErrorCategory = "busy" | "constraint" | "io" | "closed" | "unknown"

export interface DatabaseOperationMetric {
  name: string
  kind: DatabaseOperationKind
  queueDurationMs: number
  executionDurationMs: number
  errorCategory?: DatabaseErrorCategory
}

export interface DatabaseAdapter {
  readonly reader: DatabaseReader
  readonly writer: DatabaseWriter
  readonly maintenance: MaintenanceDatabase
  transaction<T>(operation: (transaction: DatabaseWriter) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export interface DatabaseService {
  read<T>(name: string, operation: (db: DatabaseReader) => Promise<T>): Promise<T>
  write<T>(name: string, operation: (db: DatabaseWriter) => Promise<T>): Promise<T>
  transaction<T>(name: string, operation: (tx: DatabaseWriter) => Promise<T>): Promise<T>
  maintenance<T>(name: string, operation: (db: MaintenanceDatabase) => Promise<T>): Promise<T>
}

export class DatabaseTransactionReentryError extends Error {
  constructor() {
    super("A top-level database write, transaction, or maintenance operation cannot be started from a transaction")
    this.name = "DatabaseTransactionReentryError"
  }
}

export function classifyDatabaseError(error: unknown): DatabaseErrorCategory {
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase()
  if (message.includes("busy") || message.includes("locked")) return "busy"
  if (message.includes("constraint")) return "constraint"
  if (message.includes("disk") || message.includes("i/o") || message.includes("ioerr")) return "io"
  if (message.includes("closed") || message.includes("not open")) return "closed"
  return "unknown"
}

interface ServiceOptions {
  open: () => Promise<DatabaseAdapter>
  initialize?: {
    name: string
    operation: (database: MaintenanceDatabase) => Promise<void>
  }
  observe?: (metric: DatabaseOperationMetric) => void
  now?: () => number
}

export function createDatabaseService(options: ServiceOptions): DatabaseService {
  const now = options.now ?? (() => Date.now())
  let adapterPromise: Promise<DatabaseAdapter> | undefined
  let writerTail: Promise<void> = Promise.resolve()
  let activeReads = 0
  let readsDrained: (() => void) | undefined
  let maintenanceRequests = 0
  let maintenanceFinished: Promise<void> = Promise.resolve()
  let finishMaintenance: (() => void) | undefined
  // Hermes has no reliable async-context primitive. This guard intentionally covers
  // only the synchronous entry into a transaction callback; keeping it set across
  // awaits would misclassify unrelated operations submitted by other callers.
  let enteringTransactionCallback = false

  const getAdapter = () => {
    if (!adapterPromise) {
      const queuedAt = options.initialize ? now() : 0
      adapterPromise = options.open().then(async (adapter) => {
        try {
          if (options.initialize) {
            await measured(options.initialize.name, "maintenance", queuedAt, async () => {
              await options.initialize!.operation(adapter.maintenance)
            })
          }
          return adapter
        } catch (error) {
          // An opened adapter is owned by this service even when initialization fails.
          // Closing is best effort and must not hide the initialization/migration error.
          try { await adapter.close() } catch { /* preserve the original error */ }
          throw error
        }
      }).catch((error) => {
        adapterPromise = undefined
        throw error
      })
    }
    return adapterPromise
  }

  const emit = (metric: DatabaseOperationMetric) => {
    // Observability must never change the result of the database operation.
    try { options.observe?.(metric) } catch { /* best-effort telemetry */ }
  }
  const validateName = (name: string) => {
    if (!name.trim()) throw new TypeError("Database operation name must not be empty")
  }

  async function measured<T>(
    name: string,
    kind: DatabaseOperationKind,
    queuedAt: number,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = now()
    try {
      const result = await operation()
      emit({ name, kind, queueDurationMs: startedAt - queuedAt, executionDurationMs: now() - startedAt })
      return result
    } catch (error) {
      emit({
        name,
        kind,
        queueDurationMs: startedAt - queuedAt,
        executionDurationMs: now() - startedAt,
        errorCategory: classifyDatabaseError(error),
      })
      throw error
    }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = writerTail.then(task, task)
    writerTail = result.then(() => undefined, () => undefined)
    return result
  }

  function rejectTransactionReentry() {
    if (enteringTransactionCallback) throw new DatabaseTransactionReentryError()
  }

  return {
    async read(name, operation) {
      validateName(name)
      const queuedAt = now()
      if (maintenanceRequests > 0) await maintenanceFinished
      activeReads += 1
      try {
        return await measured(name, "read", queuedAt, async () => operation((await getAdapter()).reader))
      } finally {
        activeReads -= 1
        if (activeReads === 0) readsDrained?.()
      }
    },

    write(name, operation) {
      validateName(name)
      rejectTransactionReentry()
      const queuedAt = now()
      return enqueue(() => measured(name, "write", queuedAt, async () => operation((await getAdapter()).writer)))
    },

    transaction(name, operation) {
      validateName(name)
      rejectTransactionReentry()
      const queuedAt = now()
      return enqueue(() => measured(name, "transaction", queuedAt, async () => {
        const adapter = await getAdapter()
        return adapter.transaction((transaction) => {
          enteringTransactionCallback = true
          try {
            return operation(transaction)
          } finally {
            enteringTransactionCallback = false
          }
        })
      }))
    },

    maintenance(name, operation) {
      validateName(name)
      rejectTransactionReentry()
      const queuedAt = now()
      if (maintenanceRequests++ === 0) {
        maintenanceFinished = new Promise<void>((resolve) => { finishMaintenance = resolve })
      }
      return enqueue(() => measured(name, "maintenance", queuedAt, async () => {
        if (activeReads > 0) await new Promise<void>((resolve) => { readsDrained = resolve })
        readsDrained = undefined
        return operation((await getAdapter()).maintenance)
      })).finally(() => {
        maintenanceRequests -= 1
        if (maintenanceRequests === 0) {
          finishMaintenance?.()
          finishMaintenance = undefined
        }
      })
    },
  }
}
