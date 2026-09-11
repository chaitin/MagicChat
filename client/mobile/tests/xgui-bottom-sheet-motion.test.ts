import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { getXGUISheetDragTranslateY } from "@/xgui/components/xgui-sheet-motion"

const root = new URL("../", import.meta.url)

async function source(path: string) {
  return readFile(new URL(path, root), "utf8")
}

test("选择器保留 Sheet，半屏选择使用 Portal 原生驱动动画", async () => {
  const [picker, halfScreen, motion] = await Promise.all([
    source("src/xgui/components/xgui-picker.tsx"),
    source("src/xgui/components/xgui-half-screen-dialog.tsx"),
    source("src/xgui/components/xgui-sheet-motion.ts"),
  ])

  assert.match(picker, /import \{ Sheet \} from "tamagui"/)
  assert.match(picker, /<Sheet\.Overlay/)
  assert.match(picker, /onAnimationComplete=/)

  assert.match(halfScreen, /import \{ Portal \} from "tamagui"/)
  assert.match(halfScreen, /Animated\.sequence\(\[/)
  assert.match(halfScreen, /Animated\.spring\(panelTranslateY/)
  assert.match(halfScreen, /toValue: -8/)
  assert.match(halfScreen, /\.\.\.XGUI_SHEET_SPRING_CONFIG/)
  assert.match(halfScreen, /useNativeDriver: true/)
  assert.match(halfScreen, /HALF_SCREEN_HEIGHT_RATIO = 0\.75/)
  assert.match(halfScreen, /duration: XGUI_SHEET_OPEN_DURATION_MS/)
  assert.match(halfScreen, /duration: XGUI_SHEET_CLOSE_DURATION_MS/)
  assert.match(halfScreen, /onPressIn=\{requestClose\}/)
  assert.match(halfScreen, /PanResponder\.create/)
  assert.match(halfScreen, /onMoveShouldSetPanResponderCapture/)
  assert.match(halfScreen, /panelTranslateY\.stopAnimation\(\)/)
  assert.match(halfScreen, /HALF_SCREEN_DRAG_REGION_HEIGHT = 84/)
  assert.match(halfScreen, /Math\.abs\(gestureState\.dy\) > 4/)
  assert.match(halfScreen, /getXGUISheetDragTranslateY\(gestureState\.dy\)/)
  assert.match(halfScreen, /animationCompleteRef\.current\?\.\(false\)/)
  assert.match(
    halfScreen,
    /presentation\.open === open && presentation\.keyboardReady/
  )
  assert.match(halfScreen, /stopTogether: false/)
  assert.match(halfScreen, /Keyboard\.addListener\("keyboardDidHide"/)
  assert.doesNotMatch(halfScreen, /react-native-reanimated|runOnJS|withTiming/)
  assert.doesNotMatch(halfScreen, /<Sheet|\bModal\b/)

  assert.match(motion, /XGUI_SHEET_OPEN_DURATION_MS = 180/)
  assert.match(motion, /XGUI_SHEET_CLOSE_DURATION_MS = 150/)
  assert.match(motion, /damping: 25,\s+mass: 1,\s+stiffness: 550/)
  assert.match(motion, /XGUI_SHEET_BOTTOM_OVERSCAN = 20/)
  assert.match(
    motion,
    /XGUI_SHEET_UPWARD_DRAG_MAX_DISTANCE = XGUI_SHEET_BOTTOM_OVERSCAN/
  )
  assert.match(motion, /XGUI_SHEET_UPWARD_DRAG_RESISTANCE = 0\.25/)
  assert.match(halfScreen, /bottom: -XGUI_SHEET_BOTTOM_OVERSCAN/)
  assert.match(halfScreen, /styles\.bottomOverscan/)
})

test("弹层上拉使用阻尼并限制最大越界距离", () => {
  assert.equal(getXGUISheetDragTranslateY(80), 80)
  assert.equal(getXGUISheetDragTranslateY(-40), -10)
  assert.equal(getXGUISheetDragTranslateY(-200), -20)
})

test("Picker 在退场完成后执行确认或取消回调并锁定重复操作", async () => {
  const picker = await source("src/xgui/components/xgui-picker.tsx")

  assert.match(picker, /closeRequestedRef\.current/)
  assert.match(picker, /pendingCloseActionRef\.current/)
  assert.match(picker, /pendingCloseAction\?\.\(\)/)
  assert.match(picker, /close\(\(\) => onConfirm\(selectedValues, selectedItems\)\)/)
  assert.match(picker, /const cancel = \(\) => close\(onCancel\)/)
})

test("ActionSheet 延迟动作在关闭动画完成后执行并阻止重复提交", async () => {
  const sheet = await source("src/xgui/components/xgui-action-sheet.tsx")

  assert.match(sheet, /actionLockedRef\.current/)
  assert.match(sheet, /const deferUntilClosed =\s+action\.deferUntilClosed === true/)
  assert.match(sheet, /import \{ Portal \} from "tamagui"/)
  assert.match(sheet, /new Animated\.Value\(windowHeight\)/)
  assert.match(sheet, /useState\(presentationOpen\)/)
  assert.match(sheet, /panelTranslateY\.stopAnimation\(\)/)
  assert.match(sheet, /stopTogether: false/)
  assert.match(sheet, /Animated\.sequence\(\[/)
  assert.match(sheet, /Animated\.spring\(panelTranslateY/)
  assert.match(sheet, /toValue: -8/)
  assert.match(sheet, /\.\.\.XGUI_SHEET_SPRING_CONFIG/)
  assert.match(sheet, /useNativeDriver: true/)
  assert.match(sheet, /duration: XGUI_SHEET_OPEN_DURATION_MS/)
  assert.match(sheet, /duration: XGUI_SHEET_CLOSE_DURATION_MS/)
  assert.match(sheet, /Easing\.out\(Easing\.cubic\)/)
  assert.match(sheet, /Easing\.out\(Easing\.quad\)/)
  assert.match(sheet, /PanResponder\.create/)
  assert.match(sheet, /Math\.abs\(gestureState\.dy\) > 4/)
  assert.match(sheet, /getXGUISheetDragTranslateY\(gestureState\.dy\)/)
  assert.match(sheet, /styles\.dragHandleArea/)
  assert.match(sheet, /useWindowDimensions\(\)/)
  assert.match(sheet, /closeRequestedRef\.current/)
  assert.match(sheet, /onPressIn=\{requestClose\}/)
  assert.match(
    sheet,
    /closeRequestedRef\.current = true\s+startCloseAnimation\(\)\s+onOpenChange\(false\)/
  )
  assert.match(sheet, /!presentationOpen \? \(/)
  assert.match(sheet, /<View pointerEvents="auto" style=\{StyleSheet\.absoluteFill\}/)
  assert.match(sheet, /borderTopLeftRadius: 12/)
  assert.match(sheet, /borderTopRightRadius: 12/)
  assert.match(sheet, /bottom: -XGUI_SHEET_BOTTOM_OVERSCAN/)
  assert.match(sheet, /styles\.bottomOverscan/)
  assert.match(sheet, /requestAnimationFrame\(pendingAction\)/)
  assert.doesNotMatch(sheet, /react-native-reanimated|runOnJS|withTiming/)
  assert.doesNotMatch(sheet, /<Sheet/)
  assert.doesNotMatch(sheet, /\bModal\b/)
})

test("上传确认保留展示数据直到退场完成", async () => {
  const dialog = await source(
    "src/features/conversation/composer/message-upload-dialog.tsx"
  )

  assert.match(dialog, /const \[presentation, setPresentation\]/)
  assert.match(dialog, /displaySelections: selections/)
  assert.match(dialog, /open=\{presentation\.open\}/)
  assert.match(dialog, /onAnimationComplete=\{\(open\) => \{/)
  assert.match(dialog, /displaySelections: \[\]/)
  assert.match(dialog, /cancelAfterCloseRef\.current/)
  assert.doesNotMatch(dialog, /if \(selections\.length === 0\) return null/)
})

test("会话置顶与免打扰不在退场期间重复显示加载层", async () => {
  const [sheet, screen, list] = await Promise.all([
    source("src/features/messages/conversation-action-sheet.tsx"),
    source("src/features/messages/messages-screen.tsx"),
    source("src/features/messages/conversation-list.tsx"),
  ])

  assert.doesNotMatch(sheet, /onBeforePress/)
  assert.match(sheet, /const ACTION_POST_CLOSE_DELAY_MS = 100/)
  assert.match(sheet, /setTimeout\(/)
  assert.doesNotMatch(screen, /onPinnedChangeStart|onMutedChangeStart/)
  assert.match(list, /delayLongPress=\{500\}/)
})

test("主题、转发、提醒、退出与注销继续接入公共弹层", async () => {
  const [me, profile, forward, mention] = await Promise.all([
    source("src/features/me/me-screen.tsx"),
    source("src/features/me/profile-screen.tsx"),
    source("src/features/conversation/forward-message-sheet.tsx"),
    source("src/features/conversation/composer/mention-picker-sheet.tsx"),
  ])

  assert.match(me, /<XGUIPicker/)
  assert.match(me, /title="退出登录"/)
  assert.match(profile, /title="注销账号"/)
  assert.match(forward, /<XGUIHalfScreenDialog/)
  assert.match(mention, /<XGUIHalfScreenDialog/)
  assert.doesNotMatch(mention, /<HalfScreenSearchInput\s+autoFocus/)
})

test("转发候选列表和头像随弹层立即显示", async () => {
  const forward = await source("src/features/conversation/forward-message-sheet.tsx")

  assert.match(forward, /<FlatList/)
  assert.match(forward, /<ConversationAvatar/)
  assert.doesNotMatch(forward, /contentReady/)
})

test("聊天内容空白点击关闭键盘且转发等待前一弹层退场", async () => {
  const conversation = await source("src/features/conversation/conversation-screen.tsx")

  assert.match(conversation, /onContentTouch=\{\(\) => \{/)
  assert.match(conversation, /Keyboard\.dismiss\(\)/)
  assert.match(conversation, /requestAnimationFrame\(\(\) => setForwardSheetOpen\(true\)\)/)
  assert.match(conversation, /deferUntilClosed: true,\s+label: "转发"/)
})
