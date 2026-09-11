import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const source = (path: string) => readFile(new URL(path, root), "utf8")

test("相册入口使用 Expo 系统选择器混合选择照片和视频", async () => {
  const [accessory, composer, picker] = await Promise.all([
    source("src/features/conversation/composer/composer-accessory-panel.tsx"),
    source("src/features/conversation/composer/message-composer.tsx"),
    source("src/features/conversation/composer/message-upload-picker.ts"),
  ])

  assert.doesNotMatch(accessory, /label="视频"|onVideoPress/)
  assert.match(composer, /handleUploadPick\(pickLibraryMediaMessage\)/)
  assert.doesNotMatch(composer, /createMediaPickerRequest|MediaLibrary/)
  assert.match(picker, /ImagePicker\.launchImageLibraryAsync\(\{/)
  assert.match(picker, /mediaTypes: \["images", "videos"\]/)
  assert.match(picker, /allowsMultipleSelection: false/)
  assert.match(picker, /selectionLimit: 1/)
  assert.match(
    picker,
    /if \(asset\.type === "video"\)[\s\S]*?prepareVideoMessage/
  )
  assert.match(picker, /preparePickedImage\(result, "image", "image\/jpeg"\)/)
})

test("系统相册选择器不依赖自定义媒体库页面和读取权限", async () => {
  const [layout, profile, picker] = await Promise.all([
    source("src/app/(app)/_layout.tsx"),
    source("src/features/me/profile-screen.tsx"),
    source("src/features/conversation/composer/message-upload-picker.ts"),
  ])

  assert.doesNotMatch(layout, /name="media-picker"/)
  assert.match(profile, /ImagePicker\.launchImageLibraryAsync\(options\)/)
  assert.doesNotMatch(profile, /createMediaPickerRequest|MediaLibrary/)
  assert.doesNotMatch(
    picker,
    /getMediaLibraryPermissionsAsync|requestMediaLibraryPermissionsAsync/
  )
})

test("视频选择完成后的确认页只展示预览和文件信息", async () => {
  const dialog = await source(
    "src/features/conversation/composer/message-upload-dialog.tsx"
  )

  assert.match(dialog, /isVideo[\s\S]*?<VideoUploadPreview/)
  assert.doesNotMatch(dialog, /视频说明|onCaptionChange|添加视频说明/)
})
