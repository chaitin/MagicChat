import { readFile } from "node:fs/promises"
import { JSON_SCHEMA, load } from "js-yaml"

export async function readWorkflow(workflowPath) {
  const workflow = load(await readFile(workflowPath, "utf8"), { schema: JSON_SCHEMA })
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error("Desktop Release 工作流必须是 YAML 对象")
  }
  return workflow
}

export function validateDesktopReleaseWorkflow(workflow) {
  assert(workflow.permissions?.contents === "read", "工作流默认权限必须是 contents: read")
  assert(
    workflow.concurrency?.group?.includes("${{ github.ref }}"),
    "concurrency 必须使用完整 Tag ref",
  )
  assert(workflow.concurrency?.["cancel-in-progress"] === false, "不得取消进行中的同 Tag 发布")
  const jobs = workflow.jobs
  assert(
    jobs && Object.keys(jobs).sort().join(",") === "package,quality,release",
    "Job 拓扑必须为 quality/package/release",
  )
  assert(jobs.package.needs === "quality", "package 必须依赖 quality")
  assert(
    Array.isArray(jobs.release.needs) &&
      jobs.release.needs.includes("package") &&
      jobs.release.needs.includes("quality"),
    "release 必须依赖 quality 和 package",
  )
  assert(
    jobs.release.permissions?.contents === "write",
    "只有 release Job 可以取得 contents: write",
  )
  assert(
    jobs.quality.permissions?.contents !== "write" &&
      jobs.package.permissions?.contents !== "write",
    "quality/package 不得取得 Release 写权限",
  )

  const qualityCommands = commands(jobs.quality)
  for (const command of ["pnpm check", "pnpm test", "pnpm build", "pnpm verify:build"]) {
    assert(qualityCommands.includes(command), `quality 缺少命令：${command}`)
  }
  const packageCommands = commands(jobs.package)
  assert(!JSON.stringify(jobs.package).includes("*.blockmap"), "package 不得上传外置 blockmap")
  assert(!JSON.stringify(jobs.package).includes("latest.yml"), "package 不得上传旧版更新清单")
  assert(!JSON.stringify(jobs.package).includes("latest-mac.yml"), "package 不得上传旧版更新清单")
  assert(!JSON.stringify(jobs.package).includes("latest-linux"), "package 不得上传旧版更新清单")
  assert(!JSON.stringify(jobs.package).includes("*.zip"), "macOS 不得生成或上传 ZIP")
  assert(
    !/pnpm (?:check|test|lint|typecheck|verify:boundaries)/.test(packageCommands),
    "package 重复执行平台无关门禁",
  )
  for (const command of [
    "pnpm build",
    "pnpm verify:build",
    "electron-builder",
    "pnpm verify:package",
  ]) {
    assert(packageCommands.includes(command), `package 缺少命令：${command}`)
  }
  const macPackageStep = jobs.package.steps.find(
    (step) => step.if === "matrix.platform == 'mac'" && step.run?.includes("electron-builder"),
  )
  assert(macPackageStep, "package 缺少独立的 macOS 签名公证步骤")
  for (const [name, reference] of [
    ["APPLE_API_ISSUER", "vars.APPLE_API_ISSUER"],
    ["APPLE_API_KEY_ID", "vars.APPLE_API_KEY_ID"],
    ["CSC_KEY_PASSWORD", "secrets.MACOS_CERTIFICATE_PASSWORD"],
    ["CSC_LINK", "secrets.MACOS_CERTIFICATE_P12_BASE64"],
    ["NOTARY_API_KEY_BASE64", "secrets.MACOS_NOTARY_API_KEY_P8_BASE64"],
  ]) {
    assert(
      String(macPackageStep.env?.[name] ?? "").includes(reference),
      `macOS 签名公证步骤缺少受管凭据：${name}`,
    )
  }
  assert(macPackageStep.run.includes("base64 -D"), "macOS 公证私钥必须从 Base64 Secret 还原")
  assert(macPackageStep.run.includes("APPLE_API_KEY"), "macOS 公证步骤未设置 API 私钥路径")
  assert(
    !Object.hasOwn(macPackageStep.env ?? {}, "CSC_IDENTITY_AUTO_DISCOVERY"),
    "macOS 签名步骤不得关闭证书发现",
  )
  const releaseCommands = commands(jobs.release)
  assert(releaseCommands.includes("release:prepare-assets"), "release 必须使用单一资产准备入口")
  assert(
    !releaseCommands.includes("release-version-base.json"),
    "不得再依赖仓库中的 release-version-base.json",
  )
  assert(
    releaseCommands.includes("needs.quality.outputs.build"),
    "Desktop build 必须来自 quality 输出",
  )
  assert(
    !releaseCommands.includes("github.run_attempt"),
    "Desktop build 不得使用 workflow 重试次数",
  )
  assert(releaseCommands.includes("release:prepare-official"), "release 必须生成官网手工上传目录")
  assert(releaseCommands.includes("release:publish"), "release 必须使用 Draft 发布事务")
  assert(!releaseCommands.includes("gh release delete"), "禁止按 Tag 删除 Release")
  assert(!releaseCommands.includes("release-assets/*"), "禁止通过通配符上传 Release 资产")
  return workflow
}

function commands(job) {
  return (job.steps ?? []).map((step) => step.run ?? "").join("\n")
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
