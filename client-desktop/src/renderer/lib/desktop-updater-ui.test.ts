import { describe, expect, it } from "vitest"
import type { UpdaterState } from "@shared/bridge"
import { updateStatusText } from "@/lib/desktop-updater-ui"
import { translate, type Translator } from "@/lib/i18n"

const baseState: UpdaterState = {
  currentBuild: 1,
  currentVersion: "1.0.0",
  installMode: "ota",
  installationSource: "nsis",
  retryable: false,
  status: "downloading",
  targetVersion: "1.1.0",
}

describe("desktop updater UI", () => {
  it("下载进度未知时显示正在下载", () => {
    expect(updateStatusText(baseState, zh)).toBe("正在下载")
  })

  it("收到下载进度后显示取整百分比", () => {
    expect(updateStatusText({ ...baseState, progress: 42.4 }, zh)).toBe("正在下载 42%")
  })
})

const zh: Translator = (key, params) => translate("zh-CN", key, params)
