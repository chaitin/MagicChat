# 对话状态功能设计方案

> 状态：已确认方案
> 范围：server、client/web、assistant

## 1. 核心原则

`conversation.status` 是仅用于 1v1 会话的瞬时信号：

- sender 决定状态内容、发送时机和续发周期。
- server 完全不保存状态，只做鉴权、路由查询和在线转发。
- receiver 收到状态后在内存展示 5 秒；新状态覆盖旧状态并重新计时。
- 不写数据库或 Redis，不进入 outbox，不带 cursor，不补发，不重放。
- 仅支持 `direct` 和 `app`；不支持 `group` 和 `topic`。
- 状态可以是任意字符串，trim 后为 1～32 个 Unicode code point。

## 2. 协议

### 请求

用户客户端和 App 使用相同方法：

```json
{
  "v": 1,
  "kind": "request",
  "id": "request-id",
  "method": "conversation.status",
  "payload": {
    "conversation_id": "conversation-id",
    "status": "正在输入"
  }
}
```

请求不能携带 sender。sender 必须来自经过认证的 WebSocket 连接。

### 事件

```json
{
  "v": 1,
  "kind": "event",
  "id": "event-id",
  "event": "conversation.status",
  "payload": {
    "conversation_id": "conversation-id",
    "status": "正在输入",
    "sender": {
      "id": "sender-id",
      "type": "user"
    }
  }
}
```

目标离线时请求仍返回成功，不能通过响应暴露目标在线状态。

## 3. Server

### 3.1 请求处理

在 `server/internal/realtime/protocol.go` 增加：

```go
EventConversationStatus = "conversation.status"
```

用户入口位于 `server/internal/httpserver/websocket_handlers.go`：

```go
func (s *Server) handleRealtimeRequest(userID string, request realtime.Envelope) realtime.Envelope
```

App 入口位于 `server/internal/httpserver/app_request_handlers.go`，新增：

```go
appMethodConversationStatus = "conversation.status"
```

两个入口共用状态解析、路由和投递逻辑。

### 3.2 校验与路由

1. 解析 `conversation_id` 和 `status`。
2. `status = strings.TrimSpace(status)`。
3. 校验 `conversation_id` 是 UUID。
4. 校验 `utf8.RuneCountInString(status)` 在 1～32 之间。
5. 加载原始会话；只接受 `direct` 或 `app`。
6. 根据认证连接校验 sender 是有效成员。
7. 查询唯一的另一方：
   - direct：user → user。
   - app：user → app，或 app → user。
8. 生成服务端可信 sender，直接投递到目标在线连接。

投递使用现有连接池：

```go
s.realtime.SendToUser(userID, event)
s.appConnections.SendToApp(appID, event)
```

禁止写入 App Event outbox 或分配 cursor。

### 3.3 错误码

| 场景 | 错误码 |
| --- | --- |
| JSON、UUID、状态长度不合法 | `invalid_request` |
| 会话不存在 | `conversation_not_found` |
| sender 不是成员 | `access_denied` |
| group/topic | `unsupported_conversation` |
| 会话拓扑异常或 DB 错误 | `internal_error` |

## 4. client/web

### 4.1 状态发送条件

只要同时满足以下条件，就发送“正在输入”：

- 当前路由是对话页面。
- 当前会话类型为 `direct` 或 `app`。
- 输入框具有焦点。
- 页面处于可见状态（`document.visibilityState === "visible"`），避免后台标签页持续上报。

行为：

1. 输入框获得焦点时立即发送一次。
2. 然后每 3 秒发送一次。
3. 输入框失焦、切换会话、离开对话页面、页面隐藏或组件卸载时停止。
4. 不要求输入框非空，不依赖 `onChange`。
5. 发送失败静默处理，不阻塞输入。

建议在 `client/web/src/components/conversation/conversation-panel-composer.tsx` 内维护焦点状态和 interval：

```ts
useEffect(() => {
  if (!focused || !visible || !supportedConversation) return

  sendStatus("正在输入")
  const timer = window.setInterval(
    () => sendStatus("正在输入"),
    3_000
  )

  return () => window.clearInterval(timer)
}, [focused, visible, supportedConversation, sendStatus])
```

### 4.2 状态接收与展示

新增 `client/web/src/hooks/use-conversation-status.ts`：

```ts
Map<conversationId, {
  sender: { id: string; type: "user" | "app" }
  text: string
  expiresAt: number
}>
```

规则：

- 订阅 `conversation.status`。
- 收到状态时以本地接收时间计算 `expiresAt = Date.now() + 5000`。
- 清除旧 timer，创建新的 5 秒 timer。
- 新状态覆盖旧状态。
- 收到同一 sender（同时比较 type 和 id）的 `message.created` 时立即清除。
- WebSocket 断开或 hook 卸载时清除全部状态和 timer。
- 不写 localStorage 或 ClientDataProvider。

第一版展示位置：

- `conversation-panel-header.tsx`：状态覆盖“私聊”或“应用”副标题。
- `conversation-panel-history.tsx`：消息区域底部显示状态气泡。
- 状态文本自身不包含省略号；Web 在文本后统一渲染三个依次跳动的圆点，并支持 `prefers-reduced-motion`。

## 5. assistant

### 5.1 状态发送条件

Assistant 在 App 私聊中按实际执行阶段发送状态：

1. 接受 `message.created` 或 `choice.response_created` 后立即发送“正在识别用户意图”，预处理期间每 2 秒续发。
2. 预处理覆盖上下文加载、话题预判、提示消息发送和话题创建；完成、失败或取消时停止。
3. 最终仍在 App 私聊中实际运行 Agent 时，先发送“正在思考”。
4. 主 Agent 使用 Anthropic 流式调用，根据 content block 实时切换：thinking → “正在思考”、tool_use 及实际工具执行 → “正在调用外部工具”、text → “正在生成回复内容”。
5. 状态切换时立即发送，同一状态持续期间每 3 秒续发；状态发送串行且不能阻塞模型流。
6. 工具执行完成进入下一轮模型请求时切回“正在思考”，多轮工具调用可重复切换。
7. Agent 完成、失败、取消、工具产生最终输出或最终回复发送后停止。
8. 如果创建了 topic，创建完成后停止识别状态，topic 内不发送 Agent 状态。
9. 状态发送为 best-effort，失败不能影响 Agent 和正常回复。

“正在识别用户意图”心跳在 `assistant/internal/appclient/client.go` 中包围消息预处理流程；Agent 动态状态由以下链路驱动：

- `assistant/internal/llm/anthropic.go` 使用流式 API 聚合完整响应，同时只上报 block 类型，不暴露 thinking 内容。
- `assistant/internal/agent/agent.go` 把流式 block 和实际工具调用映射为 thinking/tool/text phase。
- `assistant/internal/appclient/runner.go` 持有每个活跃 RunCycle 的动态状态控制器，状态变化立即发送并定时续发。
- 排队等待执行期间不发送 Agent 状态；非流式模型保留兼容回退。

### 5.2 发送 helper

在 `assistant/internal/appclient/client.go` 中，`conversationStatusSender` 通过现有 WebSocket 直接发送状态请求，不使用可靠重试和事件 outbox：

```go
func conversationStatusSender(
    writeJSON func(context.Context, envelope) error,
    conversationID string,
) func(context.Context, string) error
```

`preparedAgentRun` 持有该发送函数；runner 为每个实际 Run/RunCycle 创建动态状态控制器。控制器在后台串行发送，状态变化取消旧的在途发送，同一状态按 3 秒续发，退出时取消并等待 worker；快速完成的瞬时状态不会在回复后补发。

## 6. 测试

### Server

- direct user → user 转发。
- app user → app、app → user 转发。
- sender 不收到自己的事件。
- 目标离线仍返回成功。
- group/topic、非成员、空状态、33 字符状态被拒绝。
- 32 个 Unicode 字符通过。
- payload 不能伪造 sender。
- 不创建 outbox、cursor 或消息 seq。

### client/web

- focus 后立即发送，之后每 3 秒发送。
- blur、切换会话、卸载、页面隐藏后停止。
- direct/app 启用，group/topic 禁用。
- 收到状态后展示 5 秒。
- 续发刷新 5 秒计时器。
- 同 sender 新消息立即清除。

### assistant

- 收到 App 私聊消息或 Choice 回答后立即发送“正在识别用户意图”，预处理期间每 2 秒续发。
- 话题预判和创建完成后停止识别状态，topic 内不发送 Agent 状态。
- Agent 使用流式模型调用，并按 thinking/tool_use/text 切换“正在思考”“正在调用外部工具”“正在生成回复内容”。
- 实际工具执行期间保持“正在调用外部工具”，下一轮模型请求前切回“正在思考”。
- 状态变化立即发送，同一状态每 3 秒续发；快速完成的瞬时状态允许不发送，不能在回复后补发。
- 完成、失败和取消后停止；状态发送失败不影响最终回复。
- Agent 排队期间不发送状态。
- group/topic 不发送。

## 7. 实施顺序

1. Server 双向无状态转发及集成测试。
2. client/web 状态接收、5 秒 TTL 和展示。
3. client/web 输入框焦点驱动的 3 秒心跳。
4. assistant agent 运行周期驱动的 3 秒心跳。
5. 端到端联调：3 秒续发、5 秒消失、离线不补发。
