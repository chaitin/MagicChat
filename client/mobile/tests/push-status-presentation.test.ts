import assert from "node:assert/strict"
import test from "node:test"

import { presentPushSynchronizationState } from "@/notifications/push-status-presentation"

test("push synchronization terminal states expose actionable user labels", () => {
  assert.deepEqual(presentPushSynchronizationState("consent_required"), {
    action: "enable_jpush",
    label: "未启用",
  })
  assert.deepEqual(presentPushSynchronizationState("user_disabled"), {
    action: "enable_notifications",
    label: "已关闭",
  })
  assert.deepEqual(presentPushSynchronizationState("provider_unavailable"), {
    action: "none",
    label: "安装包未配置",
  })
  assert.deepEqual(presentPushSynchronizationState("permission_denied"), {
    action: "open_settings",
    label: "通知权限未开启",
  })
  assert.deepEqual(presentPushSynchronizationState("device_limit_reached"), {
    action: "show_device_limit",
    label: "设备数量已达上限",
  })
  assert.deepEqual(presentPushSynchronizationState("server_disabled"), {
    action: "show_server_disabled",
    label: "服务器未启用",
  })
  assert.deepEqual(presentPushSynchronizationState("temporarily_unavailable"), {
    action: "retry",
    label: "暂时不可用",
  })
  assert.deepEqual(presentPushSynchronizationState("registered"), {
    action: "none",
    label: "已启用",
  })
})
