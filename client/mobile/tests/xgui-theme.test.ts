import assert from "node:assert/strict"
import test from "node:test"

import { xguiColors } from "@/xgui/theme/colors"

test("XGUI 完整提供 WeUI 2.6.26 的 Light 和 Dark 背景色", () => {
  assert.deepEqual(
    [
      xguiColors.light.background0,
      xguiColors.light.background1,
      xguiColors.light.background2,
      xguiColors.light.background3,
      xguiColors.light.background4,
      xguiColors.light.background5,
    ],
    ["#EDEDED", "#F7F7F7", "#FFFFFF", "#F7F7F7", "#4C4C4C", "#FFFFFF"]
  )
  assert.deepEqual(
    [
      xguiColors.dark.background0,
      xguiColors.dark.background1,
      xguiColors.dark.background2,
      xguiColors.dark.background3,
      xguiColors.dark.background4,
      xguiColors.dark.background5,
    ],
    ["#111111", "#1E1E1E", "#191919", "#202020", "#404040", "#2C2C2C"]
  )
})

test("XGUI 按钮普通态和按下遮罩使用 WeUI 2.6.26", () => {
  assert.equal(xguiColors.light.brand, "#07C160")
  assert.equal(xguiColors.dark.brand, "#07C160")
  assert.equal(xguiColors.light.brand1, "#B4ECCE")
  assert.equal(xguiColors.dark.brand1, "#023A1C")
  assert.equal(xguiColors.light.brand2, "#38CD7F")
  assert.equal(xguiColors.dark.brand2, "#059A4C")
  assert.equal(xguiColors.light.brand5, "#059A4C")
  assert.equal(xguiColors.dark.brand5, "#38CD7F")
  assert.equal(xguiColors.light.indigo, "#1485EE")
  assert.equal(xguiColors.dark.indigo, "#1196FF")
  assert.equal(xguiColors.light.destructive, "#FA5151")
  assert.equal(xguiColors.dark.destructive, "#FA5151")
  assert.equal(xguiColors.light.foreground5, "rgba(0,0,0,0.05)")
  assert.equal(xguiColors.dark.foreground5, "rgba(255,255,255,0.1)")
  assert.equal(xguiColors.light.activeMask, "rgba(0,0,0,0.2)")
  assert.equal(xguiColors.dark.activeMask, "rgba(255,255,255,0.2)")
})

test("XGUI 提供通讯录入口使用的 WeUI 强调色", () => {
  assert.equal(xguiColors.light.yellow, "#FFC300")
  assert.equal(xguiColors.dark.yellow, "#CC9C00")
  assert.equal(xguiColors.light.indigo, "#1485EE")
  assert.equal(xguiColors.dark.indigo, "#1196FF")
  assert.equal(xguiColors.light.brand, "#07C160")
  assert.equal(xguiColors.dark.brand, "#07C160")
  assert.equal(xguiColors.light.blue, "#10AEFF")
  assert.equal(xguiColors.dark.blue, "#10AEFF")
})

test("XGUI 提供 WeUI 2.6.26 的 Secondary BG", () => {
  assert.equal(xguiColors.light.secondaryBackground, "rgba(0,0,0,0.05)")
  assert.equal(xguiColors.dark.secondaryBackground, "rgba(255,255,255,0.1)")
})

test("XGUI 提供 WeUI 2.6.26 的 FG-2", () => {
  assert.equal(xguiColors.light.foreground2, "rgba(0,0,0,0.3)")
  assert.equal(xguiColors.dark.foreground2, "rgba(255,255,255,0.3)")
})

test("XGUI 按钮禁用态使用 WeUI 2.6.26 的 FG-4 和 FG-5", () => {
  assert.equal(xguiColors.light.foreground0Half, "rgba(0,0,0,0.9)")
  assert.equal(xguiColors.dark.foreground0Half, "rgba(255,255,255,0.6)")
  assert.equal(xguiColors.light.foreground4, "rgba(0,0,0,0.15)")
  assert.equal(xguiColors.light.foreground5, "rgba(0,0,0,0.05)")
  assert.equal(xguiColors.dark.foreground4, "rgba(255,255,255,0.15)")
  assert.equal(xguiColors.dark.foreground5, "rgba(255,255,255,0.1)")
})

test("XGUI Toast 使用 WeUI 2.6.26 的 BG-4 和白色前景", () => {
  assert.equal(xguiColors.light.background4, "#4C4C4C")
  assert.equal(xguiColors.dark.background4, "#404040")
  assert.equal(xguiColors.light.toastForeground, "rgba(255,255,255,0.9)")
  assert.equal(xguiColors.dark.toastForeground, "rgba(255,255,255,0.9)")
})

test("XGUI Footer 使用 WeUI 2.6.26 的链接和版权色", () => {
  assert.equal(xguiColors.light.link, "#576B95")
  assert.equal(xguiColors.dark.link, "#7D90A9")
  assert.equal(xguiColors.light.footerText, "rgba(0,0,0,0.2)")
  assert.equal(xguiColors.dark.footerText, "rgba(255,255,255,0.2)")
})

test("XGUI Information Bar 使用 WeUI 2.6.26 强弱提示色", () => {
  assert.equal(
    xguiColors.light.informationBarWarnWeakBackground,
    "rgba(250,81,81,0.1)"
  )
  assert.equal(
    xguiColors.dark.informationBarWarnWeakBackground,
    "rgba(250,81,81,0.1)"
  )
  assert.equal(xguiColors.light.informationBarTipsStrongBackground, "#FA9D3B")
  assert.equal(xguiColors.dark.informationBarTipsStrongBackground, "#C87D2F")
})

test("XGUI 输入框使用 WeUI 2.6.26 占位色", () => {
  assert.equal(xguiColors.light.textPlaceholder, "rgba(0,0,0,0.3)")
  assert.equal(xguiColors.dark.textPlaceholder, "rgba(255,255,255,0.3)")
})
