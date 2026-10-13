import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")

const migratedFiles = [
  "components/avatar/app-avatar.tsx",
  "components/avatar/cached-avatar-image.tsx",
  "components/avatar/group-avatar.tsx",
  "components/buttons/compact-icon-button.tsx",
  "components/buttons/native-icon-button.tsx",
  "components/feedback/content-state.tsx",
  "components/feedback/inline-error.tsx",
  "components/forms/app-input.tsx",
  "components/forms/password-input.tsx",
  "components/icons/themed-icon.tsx",
  "components/layout/keyboard-aware-screen.tsx",
  "components/lists/app-list-item.tsx",
  "components/lists/list-item-content.tsx",
  "components/navigation/app-header.tsx",
  "components/navigation/page-header.tsx",
  "features/accounts/account-management-screen.tsx",
  "features/auth/login-form.tsx",
  "features/auth/login-method-tabs.tsx",
  "features/auth/login-screen.tsx",
  "features/contacts/contact-directory-avatar.tsx",
  "features/conversation-details/group-conversation-edit-screen.tsx",
  "features/conversation/composer/composer-accessory-panel.tsx",
  "features/conversation/composer/message-composer.tsx",
  "features/conversation/composer/message-reply-preview.tsx",
  "features/conversation/conversation-screen.tsx",
  "features/conversation/messages/collapsible-message-content.tsx",
  "features/conversation/messages/markdown-message.tsx",
  "features/conversation/messages/message-body.tsx",
  "features/conversation/messages/message-bubble.tsx",
  "features/conversation/messages/message-chart.tsx",
  "features/conversation/messages/message-list.tsx",
  "features/conversation/messages/message-choice.tsx",
  "features/conversation/messages/message-mention-text.tsx",
  "features/conversation/messages/message-reactions.tsx",
  "features/conversation-report/conversation-report-screen.tsx",
  "features/conversation/topic/topic-archive-dialog.tsx",
  "features/conversation/topic/topic-reply-preview.tsx",
  "features/image-preview/image-preview-screen.tsx",
  "features/me/account-deactivation-screen.tsx",
  "features/me/profile-nickname-screen.tsx",
  "features/me/profile-screen.tsx",
  "features/me/me-screen.tsx",
  "features/messages/conversation-avatar.tsx",
  "features/messages/conversation-list.tsx",
  "features/messages/conversation-preference-indicators.tsx",
  "features/projects/project-list.tsx",
  "features/search/search-screen.tsx",
  "features/servers/server-editor-screen.tsx",
  "features/servers/server-management-screen.tsx",
  "features/updates/app-update-dialog.tsx",
  "features/conversation/voice/message-voice-gesture-overlay.tsx",
  "features/conversation/voice/voice-message-player.tsx",
  "providers/app-providers.tsx",
  "xgui/components/xgui-action-sheet.tsx",
  "xgui/components/xgui-half-screen-dialog.tsx",
  "xgui/components/xgui-picker.tsx",
  "xgui/components/xgui-popover-menu.tsx",
]

test("小组件不再直接依赖 Tamagui", async () => {
  for (const file of migratedFiles) {
    assert.doesNotMatch(await source(file), /from ["']tamagui["']/, file)
  }
})

test("键盘布局保留安全区、滚动分支及各表单的原生间距", async () => {
  const layout = await source("components/layout/keyboard-aware-screen.tsx")
  const [login, group, report, deactivation, nickname, server] = await Promise.all([
    source("features/auth/login-screen.tsx"),
    source("features/conversation-details/group-conversation-edit-screen.tsx"),
    source("features/conversation-report/conversation-report-screen.tsx"),
    source("features/me/account-deactivation-screen.tsx"),
    source("features/me/profile-nickname-screen.tsx"),
    source("features/servers/server-editor-screen.tsx"),
  ])
  assert.match(layout, /<SafeAreaView edges=\{edges\} style=\{styles\.fill\}>/)
  assert.match(layout, /behavior=\{Platform\.select\(\{ android: "height", ios: "padding" \}\)\}/)
  assert.match(layout, /flexShrink: scrollable \? 0 : 1/)
  assert.match(layout, /scrollable && elastic \? \(/)
  assert.match(layout, /content: \{ flexGrow: 1, minHeight: 0 \}/)
  assert.match(login, /contentStyle=\{\{ alignItems: "center", paddingBottom: 128, paddingHorizontal: 18, paddingTop: 7 \}\}/)
  for (const screen of [group, deactivation, nickname, server]) {
    assert.match(screen, /contentStyle=\{\{ paddingHorizontal: 18, paddingTop: 18 \}\}/)
  }
  assert.match(report, /contentStyle=\{\{ paddingHorizontal: 18, paddingVertical: 18 \}\}/)
})

test("附件面板保留安全区、按钮间距和表情滚动高度", async () => {
  const accessory = await source("features/conversation/composer/composer-accessory-panel.tsx")
  assert.match(accessory, /marginBottom: -insets\.bottom, paddingBottom: insets\.bottom/)
  assert.match(accessory, /attachments: \{ flexDirection: "row", flexWrap: "wrap", minHeight: 132, paddingHorizontal: 13, paddingVertical: 18 \}/)
  assert.match(accessory, /emojiScroll: \{ maxHeight: 184 \}/)
  assert.match(accessory, /emojiGrid: \{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 13, paddingVertical: 4 \}/)
  assert.match(accessory, /action: \{ alignItems: "center", gap: 7, width: "25%" \}/)
  assert.match(accessory, /disabled=\{disabled\}[\s\S]*?onPress=\{onPress\}/)
  assert.match(accessory, /onPress=\{\(\) => onSelect\(value\)\}/)
  assert.match(accessory, /onEmojiPress\(value\)/)
})

test("头像外层保留尺寸、裁切、圆角与群头像图层", async () => {
  const [avatar, group] = await Promise.all([
    source("components/avatar/app-avatar.tsx"),
    source("components/avatar/group-avatar.tsx"),
  ])
  assert.match(avatar, /const AVATAR_TOKEN_SIZES = \{ "\$3": 36, "\$4": 44, "\$7": 74 \}/)
  assert.match(avatar, /size = "\$4"/)
  assert.match(avatar, /rounded[\s\S]*?resolvedSize \/ 2/)
  assert.match(avatar, /borderRadius: radius,[\s\S]*?height: resolvedSize,[\s\S]*?overflow: "hidden",[\s\S]*?width: resolvedSize/)
  assert.match(avatar, /<CompositeGroupAvatar[\s\S]*?<CachedAvatarImage/)
  assert.match(group, /size\?: AppAvatarProps\["size"\]/)
})

test("会话头像保留话题来源定位、未读徽标和列表背景", async () => {
  const [avatar, list, search] = await Promise.all([
    source("features/messages/conversation-avatar.tsx"),
    source("features/messages/conversation-list.tsx"),
    source("features/search/search-result-list.tsx"),
  ])
  assert.match(avatar, /const size = compact \? 28 : 44/)
  assert.match(avatar, /topicSource: \{ borderRadius: 34, bottom: -4, padding: 1, position: "absolute", right: -4, zIndex: 1 \}/)
  assert.match(avatar, /accessible accessibilityLabel=\{`话题来源：\$\{sourceSender\.name\}`\}/)
  assert.match(avatar, /conversation\.unreadCount > 0 \? \([\s\S]*?<XGUIBadge/)
  assert.match(list, /surroundingBackground=\{rowBackground\}/)
  assert.doesNotMatch(search, /surroundingBackground="\$color1"/)
})

test("列表文字保留紧凑尺寸、单行截断与副标题插槽", async () => {
  const list = await source("components/lists/list-item-content.tsx")
  assert.match(list, /height: compact \? 42 : 44/)
  assert.equal(list.match(/numberOfLines=\{1\}/g)?.length, 2)
  assert.match(list, /\{subtitleLeading\}[\s\S]*?\{subtitleTrailing\}/)
})

test("头像缓存图片继续保留重试、裁切及 SVG 路径", async () => {
  const avatar = await source("components/avatar/cached-avatar-image.tsx")
  assert.match(avatar, /<NativeImage[\s\S]*?key=\{revision\}[\s\S]*?onError=\{\(\) => void handleError\(\)\}[\s\S]*?resizeMode="cover"[\s\S]*?source=\{\{ uri \}\}[\s\S]*?style=\{StyleSheet\.absoluteFill\}/)
  assert.match(avatar, /if \(svg\) return \([\s\S]*?<RetryableSvgImage/)
  assert.match(avatar, /if \(failed\) return null/)
})

test("通讯录头像保留尺寸与在线圆点位置", async () => {
  const avatar = await source("features/contacts/contact-directory-avatar.tsx")
  assert.match(avatar, /avatar: \{ height: 44, width: 44 \}/)
  assert.match(avatar, /borderRadius: 5\.5,[\s\S]*?bottom: -2,[\s\S]*?height: 11,[\s\S]*?right: -2/)
})

test("编辑页保留安全区、居中宽度与输入焦点行为", async () => {
  const [group, server] = await Promise.all([
    source("features/conversation-details/group-conversation-edit-screen.tsx"),
    source("features/servers/server-editor-screen.tsx"),
  ])
  for (const screen of [group, server]) {
    assert.match(screen, /<KeyboardAwareScreen/)
    assert.match(screen, /alignSelf: "center", maxWidth: 440, width: "100%"/)
    assert.match(screen, /borderRadius: 8, overflow: "hidden"/)
  }
  assert.match(group, /autoFocus[\s\S]*?multiline=\{editingAnnouncement\}/)
  assert.match(server, /onSubmitEditing=\{\(\) => addressInputRef\.current\?\.focus\(\)\}/)
})

test("会话列表未读提醒保留主题色和字体规格", async () => {
  const list = await source("features/messages/conversation-list.tsx")
  assert.match(list, /item\.unreadAlertLabel \? \([\s\S]*?<Text[\s\S]*?color: colors\.destructive/)
  assert.match(list, /fontSize: 14/)
  assert.match(list, /fontWeight: "600"/)
})

test("项目刷新颜色和举报、注销布局继续使用 XGUI 主题", async () => {
  const [projects, report, deactivation] = await Promise.all([
    source("features/projects/project-list.tsx"),
    source("features/conversation-report/conversation-report-screen.tsx"),
    source("features/me/account-deactivation-screen.tsx"),
  ])
  assert.match(projects, /colors=\{\[colors\.brand\]\}/)
  assert.match(projects, /tintColor=\{colors\.brand\}/)
  assert.match(projects, /<View style=\{\{ backgroundColor: colors\.background0, padding: 18 \}\}>/)
  assert.match(report, /alignSelf: "center", gap: 18, maxWidth: 440, width: "100%"/)
  assert.match(deactivation, /alignSelf: "center", gap: 18, maxWidth: 440, width: "100%"/)
  assert.match(deactivation, /autoComplete="one-time-code"[\s\S]*?keyboardType="number-pad"/)
})

test("登录和账号管理保留表单间距、错误提示及账号按钮布局", async () => {
  const [login, accounts] = await Promise.all([
    source("features/auth/login-form.tsx"),
    source("features/accounts/account-management-screen.tsx"),
  ])
  assert.match(login, /<View style=\{\{ gap: 7 \}\}>/)
  assert.equal(login.match(/<View style=\{\{ gap: 18 \}\}>/g)?.length, 2)
  assert.match(accounts, /accessibilityLiveRegion="polite" style=\{\{ color: colors\.destructive/)
  assert.match(accounts, /<View style=\{\{ flexDirection: "row", gap: 7 \}\}>/)
  assert.match(accounts, /<View style=\{\{ paddingHorizontal: 18 \}\}>/)
})

test("图片预览与展开消息保留加载和展开布局", async () => {
  const [image, collapsed] = await Promise.all([
    source("features/image-preview/image-preview-screen.tsx"),
    source("features/conversation/messages/collapsible-message-content.tsx"),
  ])
  assert.match(image, /screen: \{ backgroundColor: "#000", flex: 1 \}/)
  assert.match(image, /loading: \{[\s\S]*?bottom: 0,[\s\S]*?position: "absolute",[\s\S]*?top: 0/)
  assert.match(image, /onPress=\{\(\) => void handleRetry\(\)\}/)
  assert.match(collapsed, /<View pointerEvents="none" style=\{styles\.expandLabel\}>/)
  assert.match(collapsed, /gap: 2,[\s\S]*?height: EXPAND_LABEL_HEIGHT/)
})

test("回应按钮与话题预览保留点击、折行与单行省略", async () => {
  const [reactions, topic] = await Promise.all([
    source("features/conversation/messages/message-reactions.tsx"),
    source("features/conversation/topic/topic-reply-preview.tsx"),
  ])
  assert.match(reactions, /flexWrap: "wrap"/)
  assert.match(reactions, /opacity: !canToggle \|\| pending \? 0\.7 : 1/)
  assert.equal(reactions.match(/onPressIn=\{\(event\) => event\.stopPropagation\(\)\}/g)?.length, 2)
  assert.match(topic, /<Text numberOfLines=\{1\} style=\{styles\.replyText\}>/)
  assert.match(topic, /onPress=\{onOpen\}/)
  assert.match(topic, /height: StyleSheet\.hairlineWidth/)
})

test("提及点击及选择题长按交互仍由原生组件承接", async () => {
  const [mentions, choice] = await Promise.all([
    source("features/conversation/messages/message-mention-text.tsx"),
    source("features/conversation/messages/message-choice.tsx"),
  ])
  assert.match(mentions, /onPress=\{\(\) => void openMessageLink\(textPart\.href\)\}/)
  assert.match(mentions, /onPress=\{target \? \(\) => onMentionPress\(target\) : undefined\}/)
  assert.match(choice, /<Pressable[\s\S]*?onLongPress=\{\(\) => \{[\s\S]*?didLongPressRef\.current = true/)
  assert.match(choice, /<Text style=\{styles\.contentText\}>\s*<MessageMentionText/)
  assert.match(choice, /<View style=\{\[styles\.options, \{ borderColor: colors\.separator \}\]\}>/)
})

test("个人信息与会话页保留头像布局、键盘偏移和话题关闭提示", async () => {
  const [profile, conversation] = await Promise.all([
    source("features/me/profile-screen.tsx"),
    source("features/conversation/conversation-screen.tsx"),
  ])
  assert.match(profile, /avatarTrailing: \{ alignItems: "center", flexDirection: "row", gap: 13 \}/)
  assert.match(profile, /setAvatarSheetOpen\(true\)/)
  assert.match(conversation, /keyboardVerticalOffset=\{insets\.top \+ APP_HEADER_HEIGHT\}/)
  assert.match(conversation, /paddingBottom: insets\.bottom/)
  assert.match(conversation, /onContentTouch=\{\(\) => \{[\s\S]*?Keyboard\.dismiss\(\)/)
  assert.match(conversation, /话题已关闭，无法继续发言/)
})

test("全局头部保留安全区、标题及左右按钮规格", async () => {
  const header = await source("components/navigation/app-header.tsx")
  assert.match(header, /export const APP_HEADER_HEIGHT = 44/)
  assert.match(header, /paddingTop: insets\.top/)
  assert.match(header, /height: APP_HEADER_HEIGHT,[\s\S]*?paddingHorizontal: 13/)
  assert.equal(header.match(/width: 72/g)?.length, 2)
  assert.match(header, /actions\.slice\(0, 2\)/)
  assert.match(header, /numberOfLines=\{1\}/)
})

test("编辑页公共头部保留安全区、标题和左右操作区域", async () => {
  const header = await source("components/navigation/page-header.tsx")
  assert.match(header, /export const PAGE_HEADER_HEIGHT = 56/)
  assert.match(header, /paddingTop: insets\.top/)
  assert.match(header, /paddingHorizontal: compactIconButtons \? 13 : 7/)
  assert.match(header, /fontSize: titleFontSize \?\? 15/)
  assert.equal(header.match(/width: 72/g)?.length, 2)
  assert.match(header, /onPress=\{onBackPress\}/)
  assert.match(header, /onPress=\{onActionPress\}/)
})

test("登录页保留原 Logo、字体与服务器连接行为", async () => {
  const login = await source("features/auth/login-screen.tsx")
  assert.match(login, /source=\{require\("\.\.\/\.\.\/\.\.\/assets\/images\/icon\.png"\)\}/)
  assert.match(login, /logo: \{ borderRadius: 10, height: 52, width: 52 \}/)
  assert.match(login, /body: \{ flexGrow: 1, gap: 48, justifyContent: "center" \}/)
  assert.match(login, /appName: \{ fontSize: 16, fontWeight: "600", lineHeight: 27 \}/)
  assert.match(login, /connectionFailed=\{connectionFailed\}[\s\S]*?onRetryConnection=\{\(\) => void handleRetryConnection\(\)\}/)
})

test("服务器列表保留空白收起侧滑、列表宽度与底部更新入口", async () => {
  const server = await source("features/servers/server-management-screen.tsx")
  assert.match(server, /<Pressable accessible=\{false\} onPress=\{closeOpenSwipeable\}/)
  assert.match(server, /serverListArea: \{ marginTop: 48, maxWidth: 440, paddingHorizontal: 18, width: "100%" \}/)
  assert.match(server, /edges=\{mode === "default" \? \["top", "bottom"\] : \["bottom"\]\}/)
  assert.match(server, /footer: \{ alignItems: "center", marginTop: "auto", paddingBottom: 18, paddingTop: 46 \}/)
})

test("登录切换保留禁用态和选中项语义", async () => {
  const tabs = await source("features/auth/login-method-tabs.tsx")
  assert.match(tabs, /accessibilityRole="tablist"/)
  assert.equal(tabs.match(/accessibilityRole="tab"/g)?.length, 2)
  assert.match(tabs, /accessibilityState=\{\{ disabled, selected: activeMethod === "email-code" \}\}/)
  assert.match(tabs, /accessibilityState=\{\{ disabled, selected: activeMethod === "password" \}\}/)
  assert.match(tabs, /activeMethod === "email-code" \? emailCodeContent : passwordContent/)
})

test("消息正文保留长按、图片重试、链接和图表滚动", async () => {
  const [body, markdown, chart, list] = await Promise.all([
    source("features/conversation/messages/message-body.tsx"),
    source("features/conversation/messages/markdown-message.tsx"),
    source("features/conversation/messages/message-chart.tsx"),
    source("features/conversation/messages/message-list.tsx"),
  ])
  assert.match(body, /didLongPressResourceRef\.current = true/)
  assert.match(body, /onError=\{\(\) => \{[\s\S]*?forgetLoadedAttachmentImage\(uri\)/)
  assert.match(body, /onPressIn=\{\(\) => \{[\s\S]*?didLongPressRef\.current = false/)
  assert.match(markdown, /accessibilityRole="button" onPress=\{\(\) => router\.push\(buildUrlImagePreviewHref\(source\)\)\}/)
  assert.match(markdown, /\["http:", "https:", "mailto:", "tel:"\]/)
  assert.match(chart, /style=\{\{ maxHeight: MAX_VERTICAL_CHART_HEIGHT \}\}/)
  assert.match(list, /maintainVisibleContentPosition=\{maintainVisibleContentPosition\}/)
})

test("原生覆盖层保持录音触摸穿透、层级和退场回调", async () => {
  const [host, voice, picker, providers] = await Promise.all([
    source("xgui/components/xgui-overlay-host.tsx"),
    source("features/conversation/voice/message-voice-gesture-overlay.tsx"),
    source("xgui/components/xgui-picker.tsx"),
    source("providers/app-providers.tsx"),
  ])
  assert.match(host, /sort\(\(a, b\) => a\.priority - b\.priority\)/)
  assert.match(host, /pointerEvents="box-none"/)
  assert.match(host, /context\.remove\(id\)/)
  assert.match(voice, /<XGUIOverlay priority=\{100_000\}>[\s\S]*?pointerEvents="none"/)
  assert.match(picker, /if \(action\) requestAnimationFrame\(action\)/)
  assert.match(picker, /BackHandler\.addEventListener\("hardwareBackPress"/)
  assert.match(providers, /<XGUIOverlayHost>\{children\}<\/XGUIOverlayHost>/)
})

test("关闭话题期间保持确认框且禁用所有操作", async () => {
  const dialog = await source("features/conversation/topic/topic-archive-dialog.tsx")
  assert.match(dialog, /<XGUIDialog/)
  assert.match(dialog, /dismissible=\{!saving\}/)
  assert.equal(dialog.match(/disabled: saving/g)?.length, 2)
  assert.match(dialog, /label: saving \? "关闭中…" : "确认关闭"/)
  assert.match(dialog, /onPress: onConfirm/)
  assert.match(dialog, /saving \? \([\s\S]*?<XGUILoadingIcon/)
})
