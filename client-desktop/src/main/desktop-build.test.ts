// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest"
import { desktopBuild } from "@main/desktop-build"

const originalBuild = process.env.MAGICCHAT_DESKTOP_BUILD

afterEach(() => {
  if (originalBuild === undefined) delete process.env.MAGICCHAT_DESKTOP_BUILD
  else process.env.MAGICCHAT_DESKTOP_BUILD = originalBuild
})

describe("Desktop build metadata", () => {
  it("读取编译期注入的非负整数", () => {
    process.env.MAGICCHAT_DESKTOP_BUILD = "2"
    expect(desktopBuild()).toBe(2)
  })

  it("拒绝缺失和非整数", () => {
    for (const value of [undefined, "", "2.5", "-1", "invalid"]) {
      if (value === undefined) delete process.env.MAGICCHAT_DESKTOP_BUILD
      else process.env.MAGICCHAT_DESKTOP_BUILD = value
      expect(() => desktopBuild()).toThrow("build metadata")
    }
  })
})
