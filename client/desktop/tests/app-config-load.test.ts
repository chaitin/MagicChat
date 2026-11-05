import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as auth from "../src/shared/auth.ts"
import * as desktop from "../src/shared/desktop.ts"

const require = createRequire(import.meta.url)
const saved = {
  id: "saved",
  name: "保存的服务器",
  url: "https://saved.example.test",
  builtin: false,
}
const raw = JSON.stringify({ version: 1, activeServerId: "saved", servers: [saved] })
const configCode = ts.transpileModule(
  readFileSync(new URL("../src/main/auth/app-config-store.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText
const controllerCode = ts.transpileModule(
  readFileSync(new URL("../src/main/auth-controller.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText

function ioError(code: string) {
  return Object.assign(new Error("private-path-and-secret"), { code })
}

function configFixture(options: { errors?: Error[]; source?: string; writeError?: Error } = {}) {
  const errors = [...(options.errors ?? [])]
  const writes: string[] = []
  const delays: number[] = []
  let reads = 0
  const module = { exports: {} as any }
  runInNewContext(configCode, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "node:fs/promises")
        return {
          readFile: async () => {
            reads++
            if (errors.length) throw errors.shift()
            return options.source ?? raw
          },
          mkdir: async () => {},
          writeFile: async (_file: string, value: string) => {
            if (options.writeError) throw options.writeError
            writes.push(value)
          },
          rename: async () => {},
        }
      if (name === "node:timers/promises")
        return {
          setTimeout: async (value: number) => {
            delays.push(value)
          },
        }
      if (name === "../../shared/auth") return auth
      if (name === "../../shared/desktop") return desktop
      return require(name)
    },
  })
  return {
    store: new module.exports.AppConfigStore("/fixture"),
    defaults: module.exports.createDefaultAppConfig,
    writes,
    delays,
    errors,
    get reads() {
      return reads
    },
  }
}

test("配置不存在才使用首次启动默认目录，不写入磁盘", async () => {
  const f = configFixture({ errors: [ioError("ENOENT")] })
  const loaded = await f.store.load()
  assert.equal(loaded.servers.length, 1)
  assert.equal(loaded.servers[0].id, auth.OFFICIAL_SERVER_ID)
  assert.equal(f.reads, 1)
  assert.equal(f.writes.length, 0)
})

for (const code of ["EBUSY", "EACCES", "EPERM", "EAGAIN"]) {
  test("临时读取错误" + code + "有限重试后保留已保存列表", async () => {
    const f = configFixture({ errors: [ioError(code), ioError(code)] })
    const loaded = await f.store.load()
    assert.equal(loaded.servers.length, 2)
    assert.equal(loaded.activeServerId, "saved")
    assert.equal(f.reads, 3)
    assert.deepEqual(f.delays, [100, 200])
    assert.equal(f.writes.length, 0)
  })
}

test("重试耗尽明确报错而非静默返回默认目录，稍后可再次读取成功", async () => {
  const f = configFixture({ errors: [ioError("EBUSY"), ioError("EBUSY"), ioError("EBUSY")] })
  await assert.rejects(f.store.load(), (error: any) => {
    assert.equal(error.code, "storage")
    assert.ok(!error.message.includes("private-path-and-secret"))
    return true
  })
  assert.equal(f.reads, 3)
  assert.equal(f.writes.length, 0)
  const loaded = await f.store.load()
  assert.equal(loaded.servers.length, 2)
})

test("非暂态读取错误不盲目重试，也不覆盖配置", async () => {
  const f = configFixture({ errors: [ioError("EIO")] })
  await assert.rejects(f.store.load(), (error: any) => error.code === "storage")
  assert.equal(f.reads, 1)
  assert.equal(f.delays.length, 0)
  assert.equal(f.writes.length, 0)
})

for (const source of [
  "{",
  "null",
  "[]",
  "{}",
  '{"version":2,"servers":[]}',
  '{"version":1,"servers":null}',
]) {
  test("配置损坏或根结构非法时明确报错并保留原文件：" + source, async () => {
    const f = configFixture({ source })
    await assert.rejects(f.store.load(), (error: any) => error.code === "storage")
    assert.equal(f.reads, 1)
    assert.equal(f.writes.length, 0)
  })
}

test("单条无效服务器仍按原规则跳过，不影响其他有效服务器", async () => {
  const f = configFixture({
    source: JSON.stringify({
      version: 1,
      servers: [saved, { id: "invalid", name: "", url: "file:///private" }],
    }),
  })
  const loaded = await f.store.load()
  assert.equal(loaded.servers.length, 2)
  assert.equal(loaded.servers[1].id, "saved")
})

test("旧明文凭据迁移写入失败时保留错误，不能退回空目录", async () => {
  const f = configFixture({
    source: JSON.stringify({
      version: 1,
      servers: [saved],
      accountSessions: { legacy: { token: "fixture-legacy" } },
    }),
    writeError: ioError("EACCES"),
  })
  await assert.rejects(f.store.load(), (error: any) => error.code === "storage")
  assert.equal(f.reads, 1)
  assert.equal(f.writes.length, 0)
})

function controllerFixture(load: () => Promise<unknown>) {
  const base = configFixture().defaults()
  const valid = { ...base, activeServerId: "saved", servers: [...base.servers, saved] }
  let reads = 0,
    writes = 0
  class Store {
    async load() {
      reads++
      return load()
    }
    async save() {
      writes++
    }
  }
  class Servers {
    getConfig: () => any
    constructor(_store: unknown, getConfig: () => any) {
      this.getConfig = getConfig
    }
    catalog() {
      const value = this.getConfig()
      return { activeServerId: value.activeServerId, servers: value.servers }
    }
    async save() {
      writes++
      return {}
    }
  }
  const module = { exports: {} as any }
  runInNewContext(controllerCode, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "../shared/auth") return auth
      if (name === "./auth/app-config-store")
        return { AppConfigStore: Store, createDefaultAppConfig: () => base }
      if (name === "./auth/server-manager") return { ServerManager: Servers }
      if (name === "./auth/app-settings-manager") return { AppSettingsManager: class {} }
      if (name === "./auth/account-data-facade") return { AccountDataFacade: class {} }
      if (name.startsWith("node:")) return require(name)
      return {}
    },
  })
  return {
    controller: new module.exports.AuthController("/fixture"),
    valid,
    get reads() {
      return reads
    },
    get writes() {
      return writes
    },
  }
}

for (const entry of ["getAppSettings", "getServers"]) {
  test(entry + "初始化失败不会永久缓存拒绝，当前进程重试即可恢复列表", async () => {
    let failed = true
    let f: ReturnType<typeof controllerFixture>
    f = controllerFixture(async () => {
      if (failed) throw new auth.AuthFailure("storage", "读取失败")
      return f.valid
    })
    await assert.rejects(f.controller[entry](), (error: any) => error.code === "storage")
    failed = false
    const loaded = await f.controller.getServers()
    assert.equal(loaded.servers.length, 2)
    assert.equal(f.reads, 2)
    assert.equal(f.writes, 0)
  })
}

test("并发目录读取共享初始化，成功后不反复读取配置", async () => {
  let release!: (value: unknown) => void
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const f = controllerFixture(() => pending)
  const first = f.controller.getServers()
  const second = f.controller.getServers()
  assert.equal(f.reads, 1)
  release(f.valid)
  await Promise.all([first, second])
  await f.controller.getServers()
  assert.equal(f.reads, 1)
})

test("初始化未成功时保存入口不能覆盖原有配置", async () => {
  let failed = true
  let f: ReturnType<typeof controllerFixture>
  f = controllerFixture(async () => {
    if (failed) throw new auth.AuthFailure("storage", "读取失败")
    return f.valid
  })
  await assert.rejects(f.controller.saveServer(saved), (error: any) => error.code === "storage")
  assert.equal(f.writes, 0)
  failed = false
  await f.controller.saveServer(saved)
  assert.equal(f.reads, 2)
  assert.equal(f.writes, 1)
})
