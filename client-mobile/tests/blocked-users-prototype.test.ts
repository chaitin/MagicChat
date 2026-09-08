import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const detailsScreen = await readFile(
  new URL(
    "../src/features/conversation-details/conversation-details-screen.tsx",
    import.meta.url
  ),
  "utf8"
)
const userBlockApi = await readFile(
  new URL("../src/data/user-blocks/user-block-api.ts", import.meta.url),
  "utf8"
)
const userBlockHooks = await readFile(
  new URL("../src/data/user-blocks/user-block-hooks.ts", import.meta.url),
  "utf8"
)
const messageActions = await readFile(
  new URL(
    "../src/features/conversation/messages/use-conversation-message-actions.ts",
    import.meta.url
  ),
  "utf8"
)
const meScreen = await readFile(
  new URL("../src/features/me/me-screen.tsx", import.meta.url),
  "utf8"
)
const appLayout = await readFile(
  new URL("../src/app/(app)/_layout.tsx", import.meta.url),
  "utf8"
)

test("私聊详情接入真实黑名单状态和操作", () => {
  assert.match(detailsScreen, /useUserBlockStatus/)
  assert.match(detailsScreen, /useSetUserBlocked/)
  assert.match(detailsScreen, /value=\{blockStatusQuery\.data\?\.blocked \?\? false\}/)
  assert.match(detailsScreen, /blockMutation\.mutateAsync/)
  assert.match(detailsScreen, /将无法再向你发送私聊消息/)
  assert.match(detailsScreen, /你仍可向对方发送消息/)
  assert.doesNotMatch(detailsScreen, /当前为交互预览，尚未加入黑名单/)
})

test("黑名单客户端提供状态、拉黑和解除请求", () => {
  assert.match(
    userBlockApi,
    /\/api\/client\/blocked-users\/\$\{encodeURIComponent\(userId\)\}/
  )
  assert.match(userBlockApi, /method: "DELETE" \| "GET" \| "PUT"/)
  assert.match(userBlockHooks, /getUserBlockStatus/)
  assert.match(userBlockHooks, /blockUser/)
  assert.match(userBlockHooks, /unblockUser/)
})

test("被拉黑用户发送失败时直接提示服务端错误", () => {
  assert.match(messageActions, /error\.code === "direct_message_unavailable"/)
  assert.match(messageActions, /message: error\.message/)
  assert.match(messageActions, /markOptimisticMessageFailed/)
})

test("不提供我的黑名单页面", () => {
  assert.doesNotMatch(meScreen, /title="黑名单"/)
  assert.doesNotMatch(meScreen, /\/blocked-users/)
  assert.doesNotMatch(appLayout, /name="blocked-users"/)
})
