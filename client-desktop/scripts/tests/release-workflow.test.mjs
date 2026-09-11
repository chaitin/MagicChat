import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readWorkflow, validateDesktopReleaseWorkflow } from "../workflow-tools.mjs"

const repository = path.resolve(import.meta.dirname, "../../..")
const workflowPath = path.join(repository, ".github/workflows/desktop-release.yml")

describe("Desktop Stable Release 配置", () => {
  it("通过结构化 YAML 校验三层 Job、最小权限和同 Tag 并发", async () => {
    const workflow = await readWorkflow(workflowPath)
    expect(() => validateDesktopReleaseWorkflow(workflow)).not.toThrow()
    expect(workflow.jobs.package.strategy.matrix.include).toHaveLength(5)
  })

  it("拒绝权限、依赖、并发和删除策略回归", async () => {
    const workflow = await readWorkflow(workflowPath)
    for (const mutate of [
      (value) => (value.jobs.package.permissions = { contents: "write" }),
      (value) => delete value.jobs.package.needs,
      (value) => delete value.concurrency,
      (value) => (value.concurrency["cancel-in-progress"] = true),
      (value) => value.jobs.release.steps.push({ run: "gh release delete desktop-v1.2.3" }),
    ]) {
      const candidate = structuredClone(workflow)
      mutate(candidate)
      expect(() => validateDesktopReleaseWorkflow(candidate)).toThrow()
    }
  })

  it("使用 quality 输出的 Desktop build", async () => {
    const source = await readFile(workflowPath, "utf8")
    expect(source).toContain("${{ needs.quality.outputs.build }}")
    expect(source).not.toContain("${{ github.run_attempt }}")
  })

  it("固定应用身份并禁止 electron-builder 生成旧版更新清单", async () => {
    const builder = await readFile(
      path.join(repository, "client-desktop/electron-builder.yml"),
      "utf8",
    )
    expect(builder).toContain("appId: com.magicchat.desktop")
    expect(builder).toContain("productName: 即应")
    expect(builder).not.toContain("publish:")
    expect(builder).not.toContain("target: zip")
    expect(builder).toContain("hardenedRuntime: true")
    expect(builder).toContain("notarize: true")
    expect(builder).not.toContain("identity: null")
  })

  it("拒绝移除 macOS 签名公证凭据", async () => {
    const workflow = await readWorkflow(workflowPath)
    const candidate = structuredClone(workflow)
    const macPackageStep = candidate.jobs.package.steps.find(
      (step) => step.if === "matrix.platform == 'mac'" && step.run?.includes("electron-builder"),
    )
    delete macPackageStep.env.CSC_LINK
    expect(() => validateDesktopReleaseWorkflow(candidate)).toThrow("CSC_LINK")
  })

  it("客户端构建不包含 GitHub Token 或可变更新仓库", async () => {
    const updater = await readFile(
      path.join(repository, "client-desktop/src/main/updater-service.ts"),
      "utf8",
    )
    const builder = await readFile(
      path.join(repository, "client-desktop/electron-builder.yml"),
      "utf8",
    )
    expect(`${updater}\n${builder}`).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|Authorization/i)
    expect(updater).toContain("https://github.com/ptonlix/MagicChat/releases")
    const manifest = await readFile(
      path.join(repository, "client-desktop/src/main/desktop-version-manifest.ts"),
      "utf8",
    )
    expect(manifest).toContain("https://jiying.chat/releases/version.json")
  })
})
