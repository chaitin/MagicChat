import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ExternalLinkIcon from "@hugeicons/core-free-icons/dist/esm/ExternalLinkIcon"
import MessageMultiple02Icon from "@hugeicons/core-free-icons/dist/esm/MessageMultiple02Icon"
import Volume02Icon from "@hugeicons/core-free-icons/dist/esm/Volume02Icon"
import PlayCircle02Icon from "@hugeicons/core-free-icons/dist/esm/PlayCircle02Icon"
import PauseCircleIcon from "@hugeicons/core-free-icons/dist/esm/PauseCircleIcon"

import { formatVoicePlaybackTime } from "../src/features/conversation/voice/voice-message-presentation.ts"

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")

test("链接与记录使用Desktop同款主色28px图标和两行单行文字", async () => {
  const body = await source("features/conversation/messages/message-body.tsx")
  const link = body.split("function MessageLinkBody(")[1].split("function MessageLinkCard(")[0]
  const forward = body.split("function ForwardBundleBody(")[1].split("function getImageDisplaySize(")[0]
  for (const [content, kind] of [[link, "link"], [forward, "forward"]]) {
    assert.ok(content.includes(`color={colors.textPrimary} kind="${kind}" size={28}`))
    assert.match(content, /alignItems: "center", flexDirection: "row", gap: 12, width: "100%"/)
    assert.match(content, /flex: 1, minWidth: 0/)
    assert.match(content, /numberOfLines=\{1\}[\s\S]*?color: colors\.textPrimary, fontSize: 14, lineHeight: 24/)
    assert.match(content, /numberOfLines=\{1\}[\s\S]*?color: colors\.textSecondary, fontSize: 12, lineHeight: 16/)
    assert.doesNotMatch(content, /brand5|numberOfLines=\{[24]\}/)
  }
  assert.match(link, /\{title\}[\s\S]*?\{url\}/)
  assert.match(forward, /body\.itemCount.*firstSummary/)
})

test("链接仍外部打开、长按不触发链接，普通卡片保持独立渲染", async () => {
  const body = await source("features/conversation/messages/message-body.tsx")
  assert.match(body, /<MessageLinkBody[\s\S]*?onPress=\{\(\) => void openExternalUrl\(body\.url\)\}/)
  const link = body.split("function MessageLinkBody(")[1].split("function MessageLinkCard(")[0]
  assert.match(link, /accessibilityRole="link"/)
  assert.match(link, /if \(didLongPressRef\.current\) \{\s*didLongPressRef\.current = false\s*return\s*\}\s*onPress\(\)/)
  assert.match(body, /body\.type === "card"[\s\S]*?<MessageLinkCard/)
  assert.match(body, /await Linking\.openURL\(url\)/)
})

test("普通卡片样式对齐Desktop，保留宽度与长按/点击交互", async () => {
  const body = await source("features/conversation/messages/message-body.tsx")
  const card = body.split("function MessageLinkCard(")[1].split("function ForwardBundleBody(")[0]
  assert.match(card, /gap: 8, width: "100%"/)
  assert.match(card, /color: colors\.textPrimary, fontSize: 15, fontWeight: "500", lineHeight: 23/)
  assert.match(card, /numberOfLines=\{3\}.*color: colors\.textSecondary/)
  assert.doesNotMatch(card, /ThemedIcon|accentColor|colors\.link|fontWeight: "600"|numberOfLines=\{[14]\}/)
  assert.match(card, /onLongPress\(\)/)
  assert.match(card, /if \(didLongPressRef\.current\)[\s\S]*?return[\s\S]*?onPress\?\.\(\)/)
  assert.match(body, /onPress=\{body\.url\.trim\(\) \? \(\) => void openExternalUrl\(body\.url\) : undefined\}/)
})

test("共享图标正确保留Desktop圆形播放按钮的圆环和实心三角", async () => {
  for (const icon of [ExternalLinkIcon, MessageMultiple02Icon, Volume02Icon, PlayCircle02Icon, PauseCircleIcon]) {
    assert.ok(icon.every(([tag]) => tag === "path" || tag === "circle"))
  }
  assert.equal(PlayCircle02Icon[0][0], "circle")
  assert.equal(PlayCircle02Icon[1][1].fill, "currentColor")
  assert.equal(PauseCircleIcon[0][0], "circle")
  const icon = await source("features/conversation/messages/message-content-icon.tsx")
  assert.match(icon, /tag === "circle" \?[\s\S]*?<Circle/)
  assert.match(icon, /fill: attributes\.fill === "currentColor" \? color : "none"/)
  for (const name of ["ExternalLinkIcon", "MessageMultiple02Icon", "Volume02Icon", "PlayCircle02Icon", "PauseCircleIcon"]) {
    assert.ok(icon.includes(`from "@hugeicons/core-free-icons/dist/esm/${name}"`))
  }
})

test("语音显示总时长或播放进度，时间与Desktop按秒向下取整一致", () => {
  for (const [value, expected] of [[0, "0:00"], [999, "0:00"], [1_999, "0:01"], [61_200, "1:01"], [-100, "0:00"]] as const) {
    assert.equal(formatVoicePlaybackTime(value), expected)
  }
})

test("语音布局和加载/播放/暂停按钮与文件气泡共享按下反馈", async () => {
  const voice = await source("features/conversation/voice/voice-message-player.tsx")
  assert.match(voice, /kind="voice" size=\{28\}/)
  assert.match(voice, /语音 - \{formatVoicePlaybackTime\(displayedDuration\)\}/)
  assert.match(voice, /transcript \|\| "暂无文字摘要"/)
  assert.match(voice, /numberOfLines=\{1\}/)
  assert.match(voice, /<MessageActionButton[\s\S]*?kind=\{isLoading \? "loading" : playerStatus\.playing \? "pause" : "play"\}/)
  assert.match(voice, /strokeWidth=\{isLoading \? 1\.5 : 2\}/)
  assert.match(voice, /disabled=\{isLoading\}/)
  assert.doesNotMatch(voice, /NativeIconButton|AudioLines|XGUILoadingIcon/)
})

test("语音继续互斥播放、自动下载播放和重试，并清理新增状态订阅", async () => {
  const voice = await source("features/conversation/voice/voice-message-player.tsx")
  assert.match(voice, /playerStatus\.currentTime \* 1_000/)
  assert.match(voice, /activateVoicePlayer\(\{ id: playerId, pause: \(\) => player\.pause\(\) \}\)/)
  assert.match(voice, /if \(!resourceUri\) \{\s*playWhenReadyRef\.current = true\s*onResourceRequest\(fileId\)/)
  assert.match(voice, /onResourceError\(fileId\)/)
  assert.match(voice, /player\.addListener\("playbackStatusUpdate"/)
  assert.match(voice, /status\.didJustFinish \|\| status\.error[\s\S]*?setHasPlaybackStarted\(false\)/)
  assert.match(voice, /return \(\) => subscription\.remove\(\)/)
  assert.match(voice, /await player\.seekTo\(0\)/)
  assert.match(voice, /if \(didLongPressRef\.current\)[\s\S]*?return[\s\S]*?if \(isLoading\) return/)
})
