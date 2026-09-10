import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const source = (path: string) => readFile(new URL(path, root), "utf8")

test("相册入口混合展示照片和视频并限制单选", async () => {
  const [accessory, composer, picker, route] = await Promise.all([
    source("src/features/conversation/composer/composer-accessory-panel.tsx"),
    source("src/features/conversation/composer/message-composer.tsx"),
    source("src/xgui/components/xgui-media-picker.tsx"),
    source("src/app/(app)/media-picker.tsx"),
  ])

  assert.doesNotMatch(accessory, /label="视频"|onVideoPress/)
  assert.match(
    composer,
    /createMediaPickerRequest\(\{[\s\S]*?maxSelection: 1,[\s\S]*?mediaKind: "mixed",[\s\S]*?mode: "single"/
  )
  assert.doesNotMatch(composer, /handleVideoPick|pickLibraryVideoMessage/)
  assert.match(
    composer,
    /Platform\.OS === "android"[\s\S]*?MediaLibrary\.getAssetContentUriAsync\(asset\)[\s\S]*?: await MediaLibrary\.getAssetInfoAsync\(asset\)/
  )
  assert.match(
    picker,
    /mediaKind === "mixed"[\s\S]*?MediaLibrary\.MediaType\.photo,[\s\S]*?MediaLibrary\.MediaType\.video/
  )
  assert.match(
    picker,
    /item\.mediaType === MediaLibrary\.MediaType\.video[\s\S]*?VideoAssetThumbnail/
  )
  assert.match(route, /mediaKind=\{request\.mediaKind\}/)
})

test("Android 原生清单声明视频读取权限且等待页有状态提示", async () => {
  const [manifest, picker] = await Promise.all([
    source("android/app/src/main/AndroidManifest.xml"),
    source("src/xgui/components/xgui-media-picker.tsx"),
  ])

  assert.match(manifest, /android\.permission\.READ_MEDIA_VIDEO/)
  assert.match(picker, /PermissionsAndroid\.PERMISSIONS\.READ_MEDIA_IMAGES/)
  assert.match(picker, /PermissionsAndroid\.PERMISSIONS\.READ_MEDIA_VIDEO/)
  assert.match(picker, /正在请求照片和视频访问权限/)
})

test("视频选择完成后的确认页只展示预览和文件信息", async () => {
  const dialog = await source(
    "src/features/conversation/composer/message-upload-dialog.tsx"
  )

  assert.match(dialog, /isVideo[\s\S]*?<VideoUploadPreview/)
  assert.doesNotMatch(dialog, /视频说明|onCaptionChange|添加视频说明/)
})
