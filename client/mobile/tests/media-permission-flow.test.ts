import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { requestPermissionForUserAction } from "@/features/permissions/media-permission"

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("已授权直接继续且不会再次请求系统权限", async () => {
  let requests = 0
  const result = await requestPermissionForUserAction(
    async () => ({ canAskAgain: true, granted: true }),
    async () => { requests += 1; return { canAskAgain: true, granted: true } }
  )
  assert.equal(result, "granted")
  assert.equal(requests, 0)
})

test("可再次申请时直接请求，拒绝后结束本次操作", async () => {
  let requests = 0
  const result = await requestPermissionForUserAction(
    async () => ({ canAskAgain: true, granted: false }),
    async () => { requests += 1; return { canAskAgain: false, granted: false } }
  )
  assert.equal(result, "denied")
  assert.equal(requests, 1)
})

test("永久拒绝时不调用系统申请而是要求打开设置", async () => {
  let requests = 0
  const result = await requestPermissionForUserAction(
    async () => ({ canAskAgain: false, granted: false }),
    async () => { requests += 1; return { canAskAgain: false, granted: false } }
  )
  assert.equal(result, "settings")
  assert.equal(requests, 0)
})

test("权限设置 Dialog 打开设置时保持显示，仅取消会关闭", async () => {
  const dialog = await source("src/components/permissions/media-permission-settings-dialog.tsx")
  assert.match(dialog, /label: "取消", onPress: cancel/)
  assert.match(dialog, /label: "打开设置"[\s\S]*?onPress: openSettings/)
  assert.match(dialog, /Linking\.openSettings\(\)\.catch\(\(\) => setSettingsError\(true\)\)/)
  assert.match(dialog, /无法打开系统设置，请手动前往系统设置开启/)
  assert.doesNotMatch(dialog, /label: "打开设置"[\s\S]{0,160}?onCancel/)
  assert.match(dialog, /open=\{kind !== null\}/)
})

test("系统相册选择器不提前申请照片库读取权限", async () => {
  const [composerPicker, profile] = await Promise.all([
    source("src/features/conversation/composer/message-upload-picker.ts"),
    source("src/features/me/profile-screen.tsx"),
  ])
  assert.match(composerPicker, /ImagePicker\.launchImageLibraryAsync/)
  assert.match(profile, /ImagePicker\.launchImageLibraryAsync/)
  assert.doesNotMatch(
    `${composerPicker}\n${profile}`,
    /getMediaLibraryPermissionsAsync|requestMediaLibraryPermissionsAsync/
  )
})

test("相机入口统一使用直接申请和永久拒绝 Dialog", async () => {
  const [composerPicker, composer, profile, scanner] = await Promise.all([
    source("src/features/conversation/composer/message-upload-picker.ts"),
    source("src/features/conversation/composer/message-composer.tsx"),
    source("src/features/me/profile-screen.tsx"),
    source("src/features/qr-scanner/qr-scanner-screen.tsx"),
  ])
  assert.match(composerPicker, /requestPermissionForUserAction\([\s\S]*?getCameraPermissionsAsync[\s\S]*?requestCameraPermissionsAsync/)
  assert.match(composer, /MediaPermissionSettingsDialog[\s\S]*?upload\.permissionSettingsRequired/)
  assert.match(profile, /requestPermissionForUserAction\([\s\S]*?getCameraPermissionsAsync[\s\S]*?requestCameraPermissionsAsync/)
  assert.match(profile, /permission === "denied"\) return[\s\S]*?permission === "settings"/)
  assert.match(scanner, /if \(!permission\.canAskAgain\) \{[\s\S]*?setPermissionDialogOpen\(true\)/)
  assert.match(scanner, /requestPermission\(\)[\s\S]*?if \(!response\.granted\) router\.back\(\)/)
  assert.match(scanner, /catch\(\(error: unknown\)[\s\S]*?无法申请相机权限[\s\S]*?router\.back\(\)/)
  assert.match(scanner, /MediaPermissionSettingsDialog[\s\S]*?kind=\{permissionDialogOpen \? "camera" : null\}/)
  assert.doesNotMatch(scanner, /XGUIActionSheet|permissionSheetOpen|允许使用相机/)
})
