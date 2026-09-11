import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertMachine,
  parseElfMachine,
  parsePeMachine,
  verifyLinuxPackage,
  verifyMacPackage,
  verifyWindowsPackage,
} from "../native-package-tools.mjs"

describe("原生安装包真实性解析", () => {
  it.each([
    ["x64", 0x8664],
    ["arm64", 0xaa64],
  ])("读取 %s PE Machine", (arch, machine) => {
    const fixture = peFixture(machine)
    expect(parsePeMachine(fixture)).toBe(machine)
    expect(() => assertMachine(machine, arch, "PE")).not.toThrow()
    expect(() => assertMachine(machine, arch === "x64" ? "arm64" : "x64", "PE")).toThrow("不一致")
  })

  it.each([
    ["x64", 0x3e],
    ["arm64", 0xb7],
  ])("读取 %s ELF Machine", (arch, machine) => {
    const fixture = elfFixture(machine)
    expect(parseElfMachine(fixture)).toBe(machine)
    expect(() => assertMachine(machine, arch, "ELF")).not.toThrow()
  })

  it.each([
    ["x64", 0x8664],
    ["arm64", 0xaa64],
  ])("校验 Windows %s 安装器与打包应用", async (arch, machine) => {
    const fixture = await windowsPackageFixture(arch)
    let calls = 0
    await expect(
      verifyWindowsPackage({
        ...fixture,
        executeCommand: async () => ({ stdout: calls++ === 0 ? "1.2.3\n" : "1.2.3.0\n" }),
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).resolves.toMatchObject({
      installerMachine: 0x14c,
      machine,
    })
  })

  it.each(["1.2.30", "1.2.3-beta", "1.2.3.0"])(
    "拒绝 Windows 安装器错误文件版本 %s",
    async (productVersion) => {
      const fixture = await windowsPackageFixture("x64")
      await expect(
        verifyWindowsPackage({
          ...fixture,
          executeCommand: async () => ({ stdout: `${productVersion}\n` }),
          expectedBuild: 2,
          expectedVersion: "1.2.3",
          readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
        }),
      ).rejects.toThrow(`期望 1.2.3，实际 ${productVersion}`)
    },
  )

  it("拒绝 Windows 打包应用与安装器文件版本不一致", async () => {
    const fixture = await windowsPackageFixture("x64")
    let calls = 0
    await expect(
      verifyWindowsPackage({
        ...fixture,
        executeCommand: async () => ({ stdout: calls++ === 0 ? "1.2.3\n" : "1.2.30.0\n" }),
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).rejects.toThrow("Windows 打包应用文件版本与 Tag 不一致")
  })

  it("拒绝错误格式和 Windows 打包应用架构不匹配", async () => {
    expect(() => parsePeMachine(Buffer.alloc(64))).toThrow("PE")
    expect(() => parseElfMachine(Buffer.alloc(20))).toThrow("ELF")
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-invalid-windows-"))
    const brokenArtifact = path.join(root, "broken.exe")
    await writeFile(brokenArtifact, "broken")
    await expect(
      verifyWindowsPackage({
        arch: "x64",
        applicationDirectory: "missing",
        artifact: brokenArtifact,
        executeCommand: async () => ({ stdout: "1.2.3\n" }),
        expectedBuild: 2,
        expectedVersion: "1.2.3",
      }),
    ).rejects.toThrow("有效 PE")

    const applicationDirectory = path.join(root, "application")
    await mkdir(path.join(applicationDirectory, "resources"), { recursive: true })
    const artifact = path.join(root, "installer.exe")
    await writeFile(artifact, peFixture(0x14c))
    await writeFile(path.join(applicationDirectory, "即应.exe"), peFixture(0x8664))
    await writeFile(path.join(applicationDirectory, "resources/app.asar"), "asar")
    await expect(
      verifyWindowsPackage({
        arch: "arm64",
        applicationDirectory,
        artifact,
        executeCommand: async () => ({ stdout: "1.2.3\n" }),
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).rejects.toThrow("目标架构不一致")
  })

  it("从 DMG 读取 plist、Universal 架构与 app.asar 版本", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-mac-fixture-"))
    const executeCommand = async (command, args) => {
      if (command.endsWith("hdiutil") && args[0] === "attach") {
        await createMacApplication(path.join(args[4], "即应.app"))
      }
      if (command.endsWith("plutil")) {
        return { stdout: args[1] === "CFBundleIdentifier" ? "com.magicchat.desktop\n" : "1.2.3\n" }
      }
      if (command.endsWith("lipo")) return { stdout: "x86_64 arm64\n" }
      if (command.endsWith("codesign") && args[0] === "-dv") {
        return {
          stderr:
            "Authority=Developer ID Application: Duke Tao (8RK3WCWST9)\nTeamIdentifier=8RK3WCWST9\n",
          stdout: "",
        }
      }
      return { stdout: "" }
    }
    await expect(
      verifyMacPackage({
        dmg: path.join(root, "app.dmg"),
        executeCommand,
        expectedTeamId: "8RK3WCWST9",
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).resolves.toMatchObject({ architectures: ["x86_64", "arm64"] })
    await expect(
      verifyMacPackage({
        dmg: path.join(root, "bad.dmg"),
        executeCommand: async (command, args) => {
          const result = await executeCommand(command, args)
          return command.endsWith("lipo") ? { stdout: "arm64\n" } : result
        },
        expectedTeamId: "8RK3WCWST9",
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).rejects.toThrow("Universal")

    await expect(
      verifyMacPackage({
        dmg: path.join(root, "wrong-team.dmg"),
        executeCommand: async (command, args) => {
          const result = await executeCommand(command, args)
          if (command.endsWith("codesign") && args[0] === "-dv") {
            return {
              stderr:
                "Authority=Developer ID Application: Duke Tao (OTHERTEAM)\nTeamIdentifier=OTHERTEAM\n",
              stdout: "",
            }
          }
          return result
        },
        expectedTeamId: "8RK3WCWST9",
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).rejects.toThrow("Team ID")
  })

  it.each([
    ["x64", 0x3e, "amd64"],
    ["arm64", 0xb7, "arm64"],
  ])(
    "从 AppImage ELF 与 deb 元数据读取 Linux %s 真实架构和版本",
    async (arch, machine, debArch) => {
      const fixture = await createLinuxPackageFixture({ debArch, machine })
      await expect(
        verifyLinuxPackage({
          appImage: fixture.appImage,
          arch,
          deb: fixture.deb,
          executeCommand: fixture.executeCommand,
          expectedBuild: 2,
          expectedVersion: "1.2.3",
          readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
        }),
      ).resolves.toMatchObject({ appImageMachine: machine, debArchitecture: debArch })
      expect(fixture.metadataFields).toEqual(["Architecture", "Version"])
    },
  )

  it.each([
    [{ debArch: "arm64" }, "deb 架构与目标不一致：期望 amd64，实际 arm64"],
    [{ debVersion: "1.2.4" }, "deb 版本与 Tag 不一致：期望 1.2.3，实际 1.2.4"],
  ])("拒绝 deb 元数据不匹配", async (overrides, message) => {
    const fixture = await createLinuxPackageFixture({ machine: 0x3e, ...overrides })
    await expect(
      verifyLinuxPackage({
        appImage: fixture.appImage,
        arch: "x64",
        deb: fixture.deb,
        executeCommand: fixture.executeCommand,
        expectedBuild: 2,
        expectedVersion: "1.2.3",
        readAsarMetadata: async () => ({ build: 2, version: "1.2.3" }),
      }),
    ).rejects.toThrow(message)
  })
})

async function windowsPackageFixture(arch) {
  const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-nsis-version-fixture-"))
  const artifact = path.join(root, `Jiying-1.2.3-win-${arch}.exe`)
  const applicationDirectory = path.join(root, "application")
  await mkdir(path.join(applicationDirectory, "resources"), { recursive: true })
  await writeFile(artifact, peFixture(0x14c))
  await writeFile(
    path.join(applicationDirectory, "即应.exe"),
    peFixture(arch === "x64" ? 0x8664 : 0xaa64),
  )
  await writeFile(path.join(applicationDirectory, "resources/app.asar"), "asar")
  return { arch, applicationDirectory, artifact }
}

function peFixture(machine) {
  const fixture = Buffer.alloc(256)
  fixture.write("MZ")
  fixture.writeUInt32LE(128, 0x3c)
  fixture.write("PE\0\0", 128)
  fixture.writeUInt16LE(machine, 132)
  return fixture
}

function elfFixture(machine) {
  const fixture = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(fixture)
  fixture[5] = 1
  fixture.writeUInt16LE(machine, 18)
  return fixture
}

async function createLinuxPackageFixture({ debArch = "amd64", debVersion = "1.2.3", machine }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-linux-fixture-"))
  const appImage = path.join(root, "app.AppImage")
  const deb = path.join(root, "app.deb")
  const metadataFields = []
  const executeCommand = async (command, args, options) => {
    if (command === appImage) {
      const extracted = path.join(options.cwd, "squashfs-root")
      await mkdir(path.join(extracted, "resources"), { recursive: true })
      await writeFile(path.join(extracted, "magicchat-desktop"), elfFixture(machine))
      await writeFile(path.join(extracted, "resources/app.asar"), "asar")
    } else if (command === "dpkg-deb" && args[0] === "-f") {
      metadataFields.push(args[2])
      return { stdout: `${args[2] === "Architecture" ? debArch : debVersion}\n` }
    } else if (command === "dpkg-deb" && args[0] === "-x") {
      await mkdir(path.join(args[2], "usr/lib/magicchat/resources"), { recursive: true })
      await writeFile(
        path.join(args[2], "usr/lib/magicchat/magicchat-desktop"),
        elfFixture(machine),
      )
      await writeFile(path.join(args[2], "usr/lib/magicchat/resources/app.asar"), "asar")
    }
    return { stdout: "" }
  }
  return { appImage, deb, executeCommand, metadataFields }
}

async function createMacApplication(application) {
  await mkdir(path.join(application, "Contents/MacOS"), { recursive: true })
  await mkdir(path.join(application, "Contents/Resources"), { recursive: true })
  await writeFile(path.join(application, "Contents/Info.plist"), "plist")
  await writeFile(path.join(application, "Contents/MacOS/即应"), "binary")
  await writeFile(path.join(application, "Contents/Resources/app.asar"), "asar")
}
