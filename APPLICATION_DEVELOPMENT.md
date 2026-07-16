# 第三方应用接入开发指南

本文面向“即应”的第三方应用开发者，介绍如何创建应用、建立 WebSocket 连接、接收消息并调用允许的应用 RPC。

第三方应用的权限由 Server 强制限制。应用密钥不能调用联系人、项目、任务、建群、代用户发送消息或其他茉莉专属 RPC；修改客户端代码或请求参数无法绕过这些限制。

## 1. 接入流程

1. 用户登录即应，在自己的用户会话下调用应用管理 API 创建应用。
2. 保存创建响应中的 `app.id` 和 `connection_secret`。密钥不会出现在后续列表或详情响应中。
3. 使用 App ID 和连接密钥连接 `/api/app/ws`。
4. 处理 Server 推送的 `message.created`，完成持久化或业务处理后调用 `events.ack`。
5. 通过允许的 RPC 读取应用所在会话的历史、以应用身份发消息，或获取消息所引用的临时文件 URL。

应用被禁用、删除、重置密钥或收缩授权范围时，Server 会主动关闭该应用已有的 WebSocket 连接。应用创建者账号被管理员禁用时，其创建的应用也会同时停用并断开连接。

## 2. 创建和管理应用

应用管理 API 位于 `/api/client/apps`，使用当前登录用户的即应 Session Cookie 鉴权。只有创建者可以查看和管理自己的应用。

### 2.1 可见范围

| `visibility` | 含义 |
| --- | --- |
| `creator` | 仅创建者可发现、打开或被应用主动联系。创建时不传 `visibility` 也使用此值。 |
| `restricted` | 创建者和 `user_ids` 中的指定用户可访问。创建者是隐式授权，不需要写入 `user_ids`。 |
| `public` | 所有有效用户均可发现、打开或被应用主动联系。 |

单个 restricted 应用最多可指定 500 名有效用户。非 restricted 应用会忽略并清空授权用户列表。

每个用户最多创建 20 个应用。应用名称最多 120 个字符，备注最多 2000 个字符；创建和更新接口的 JSON 请求体最大为 64 KiB。

应用主动向用户发送消息时也会执行同一套可见范围检查。只有 public 应用可以作为应用成员被用户加入群聊；creator 或 restricted 应用不会因进入群聊而绕过用户授权。

当应用从 public 收缩为 creator 或 restricted，或从 restricted 移除授权用户时，Server 会立即关闭应用连接，并撤销不再授权的既有会话访问：相关应用单聊会变为只读，应用会退出已有群聊，未投递的相关事件也会被清理。之后重新授权不会恢复此前已撤销的会话历史。

### 2.2 创建应用

```http
POST /api/client/apps
Content-Type: application/json

{
  "name": "报表机器人",
  "description": "接收消息并生成业务报表",
  "visibility": "restricted",
  "user_ids": [
    "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"
  ]
}
```

成功响应为 `201 Created`：

```json
{
  "success": true,
  "data": {
    "app": {
      "id": "6b98ad5c-4e32-4f2a-95be-f0a229a9e91b",
      "name": "报表机器人",
      "description": "接收消息并生成业务报表",
      "avatar": "",
      "enabled": true,
      "visibility": "restricted",
      "user_ids": ["7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"],
      "connection_status": "offline",
      "created_at": "2026-07-16T06:00:00Z",
      "updated_at": "2026-07-16T06:00:00Z"
    },
    "connection_secret": "保存这个密钥"
  }
}
```

`connection_secret` 只通过创建和重置密钥接口返回。调用方应立即保存到密钥管理系统，禁止写入源码、日志、客户端安装包或公开仓库。

### 2.3 管理接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/client/apps` | 列出当前用户创建的应用，不返回密钥。 |
| `POST` | `/api/client/apps` | 创建应用，并返回新密钥。 |
| `GET` | `/api/client/apps/:app_id` | 获取应用详情，不返回密钥。 |
| `PATCH` | `/api/client/apps/:app_id` | 更新名称、备注、可见范围或授权用户。只修改请求中出现的字段。 |
| `DELETE` | `/api/client/apps/:app_id` | 删除应用并断开连接。 |
| `POST` | `/api/client/apps/:app_id/avatar` | 上传头像。使用 multipart 字段 `file`，必须是 256×256 WebP，最大 1 MiB。 |
| `POST` | `/api/client/apps/:app_id/enable` | 启用应用。 |
| `POST` | `/api/client/apps/:app_id/disable` | 禁用应用并断开连接。 |
| `POST` | `/api/client/apps/:app_id/secret/regenerate` | 生成并返回新密钥，旧密钥立即失效，已有连接被关闭。 |

更新 restricted 授权用户的示例：

```http
PATCH /api/client/apps/6b98ad5c-4e32-4f2a-95be-f0a229a9e91b
Content-Type: application/json

{
  "name": "新版报表机器人",
  "visibility": "restricted",
  "user_ids": [
    "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4",
    "4e4dd332-2e18-4fc6-b48c-b060890e1ebc"
  ]
}
```

## 3. 建立 WebSocket 连接

连接地址：

```text
wss://<server-host>/api/app/ws
```

握手请求必须携带：

```http
X-MagicChat-App-ID: 6b98ad5c-4e32-4f2a-95be-f0a229a9e91b
Authorization: Bearer <connection_secret>
```

握手错误：

| HTTP 状态 | 含义 |
| --- | --- |
| `400` | App ID 格式错误。 |
| `401` | 应用不存在、密钥错误或密钥已重置。 |
| `403` | 应用已禁用。 |

Server 每 30 秒发送 WebSocket Ping，60 秒内未收到 Pong 会关闭连接。常用 WebSocket 库会自动回复 Pong；如果使用自定义协议栈，必须自行处理 Ping/Pong。单个入站或出站 WebSocket 消息上限为 1 MiB。

同一 App ID 可以同时建立多个连接。事件会广播到全部在线连接，因此各实例必须按 `cursor` 做幂等处理；任意实例 ACK 后，该 ACK 对整个应用生效。

## 4. Envelope 协议

当前协议版本为 `1`。应用发出的每条业务消息都必须是 `request`：

```json
{
  "v": 1,
  "kind": "request",
  "id": "req-018f7e00-1",
  "method": "conversation.messages.list",
  "payload": {}
}
```

`id` 由应用生成，在同一个 App 下应保持唯一。Server 会短期缓存相同请求 ID 的响应，以便网络重试时避免重复执行：

- 相同 `id`、方法和 payload 会返回第一次执行的响应。
- 相同 `id` 携带不同内容会返回 `request_id_conflict`。

成功响应：

```json
{
  "v": 1,
  "kind": "response",
  "id": "server-response-id",
  "reply_to": "req-018f7e00-1",
  "ok": true,
  "payload": {}
}
```

失败响应：

```json
{
  "v": 1,
  "kind": "response",
  "id": "server-response-id",
  "reply_to": "req-018f7e00-1",
  "ok": false,
  "error": {
    "code": "forbidden",
    "message": "当前应用无权调用该方法"
  }
}
```

常见错误码包括 `invalid_request`、`forbidden`、`not_found`、`internal_error`、`unsupported_version`、`request_id_conflict` 和 `response_too_large`。

## 5. 权限边界

普通第三方应用只有以下能力：

- 接收自身参与会话产生的 `message.created`。
- 调用 `conversation.messages.list` 读取自身所在会话的可见历史。
- 调用 `message.send` 以应用身份发送消息。
- 调用 `temporary_files.read_urls` 获取有权访问的消息所引用的临时文件 URL。
- 调用 `events.ack` 确认已持久处理的事件。

第三方应用调用任何其他 App RPC 都会得到 `forbidden`。尤其禁止：

- `runas` 和 `message.send_as_user`。
- 联系人目录、任意用户会话历史、建群和群成员管理。
- 项目、任务和其他业务数据 RPC。
- 发送 `entity_card` 消息。
- 仅凭一个临时文件 ID 换取下载 URL。

茉莉使用固定系统应用身份，保留原有内部 RPC；该权限不会授予用户创建的应用。

## 6. 接收 `message.created`

事件格式：

```json
{
  "v": 1,
  "kind": "event",
  "id": "event-envelope-id",
  "cursor": 1287,
  "event": "message.created",
  "payload": {
    "conversation": {
      "id": "f967369f-9fd3-4058-92f0-b1960b5ea783",
      "name": "报表机器人",
      "type": "app"
    },
    "sender": {
      "id": "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4",
      "type": "user",
      "name": "Alice",
      "nickname": "Alice",
      "email": "alice@example.com"
    },
    "message": {
      "id": "25347bdd-c500-4108-929b-423ca4d1067a",
      "seq": 42,
      "body": {"type": "text", "content": "请生成本周报表"},
      "summary": "请生成本周报表",
      "created_at": "2026-07-16T06:05:00Z"
    }
  }
}
```

应用一对一会话中的用户消息会推送给该应用。群聊沿用现有消息规则：应用是群成员且被消息直接 `@` 时才收到事件；普通群消息和 `@all` 不会推送给应用。

事件先写入 Server outbox，再发送到在线连接。未 ACK 的事件会在重连时按 cursor 升序重放，每页最多 100 条。推荐处理顺序：

1. 按 `(app_id, cursor)` 去重。
2. 将事件和业务结果持久化。
3. 持久化成功后调用 `events.ack`。

不要在业务处理完成前 ACK。

## 7. `events.ack`

```json
{
  "v": 1,
  "kind": "request",
  "id": "ack-1287",
  "method": "events.ack",
  "payload": {
    "cursor": 1287
  }
}
```

成功 payload：

```json
{"cursor": 1287}
```

ACK 某个 cursor 会确认并清理该应用不大于此 cursor 的事件。重复 ACK 已确认的旧 cursor 是幂等的。

## 8. `conversation.messages.list`

应用只能读取自己仍是有效成员的会话，且不能读取早于其 `history_visible_from_seq` 的消息。

```json
{
  "v": 1,
  "kind": "request",
  "id": "history-42",
  "method": "conversation.messages.list",
  "payload": {
    "conversation_id": "f967369f-9fd3-4058-92f0-b1960b5ea783",
    "before_or_equal_seq": 42,
    "limit": 30
  }
}
```

- `before_or_equal_seq` 必须是正整数。通常使用刚收到事件或发送响应中的 `message.seq`。
- `limit` 默认 30，最大 100。
- 返回消息按 seq 升序排列。
- 已撤回消息不返回原始 body，只返回撤回摘要。
- 请求中不要携带 `runas`；第三方应用无权使用该字段。

响应 payload 示例：

```json
{
  "limit": 30,
  "messages": [
    {
      "id": "25347bdd-c500-4108-929b-423ca4d1067a",
      "seq": 42,
      "sender": {
        "id": "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4",
        "type": "user",
        "name": "Alice",
        "nickname": "Alice",
        "email": "alice@example.com"
      },
      "body": {"type": "text", "content": "请生成本周报表"},
      "summary": "请生成本周报表",
      "created_at": "2026-07-16T06:05:00Z"
    }
  ]
}
```

## 9. `message.send`

### 9.1 回复已有应用会话

```json
{
  "v": 1,
  "kind": "request",
  "id": "reply-42",
  "method": "message.send",
  "payload": {
    "target": {
      "type": "app",
      "conversation_id": "f967369f-9fd3-4058-92f0-b1960b5ea783"
    },
    "message": {
      "type": "markdown",
      "content": "## 本周报表\n\n已生成 5 项统计。"
    }
  }
}
```

### 9.2 向授权范围内的用户主动发送

```json
{
  "v": 1,
  "kind": "request",
  "id": "proactive-1",
  "method": "message.send",
  "payload": {
    "target": {
      "type": "user",
      "user_id": "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"
    },
    "message": {
      "type": "text",
      "content": "日报已经生成。"
    }
  }
}
```

Server 会创建或复用该用户与应用的一对一会话。目标用户必须符合应用的 creator/restricted/public 访问范围，否则返回 `forbidden`。

### 9.3 向已有群聊发送

```json
{
  "v": 1,
  "kind": "request",
  "id": "group-reply-1",
  "method": "message.send",
  "payload": {
    "target": {
      "type": "group",
      "conversation_id": "ae76b535-5dc1-42a9-b829-27d0402b5757"
    },
    "message": {
      "type": "text",
      "content": "报表已更新。"
    }
  }
}
```

应用必须已经是该群聊的有效成员，且会话处于可发言状态。对 `type: "app"` 的目标也执行相同的成员校验。

成功响应 payload 包含 `conversation`、`message` 和 `created`。同一个请求 ID 重试不会重复创建消息。

第三方应用可以发送现有的普通消息类型，例如 `text`、`markdown`、`link`、`card`、`chart`、`image` 和 `file`；不能发送 `entity_card`。图片和文件会由 Server 按现有消息规则校验和转存，整个请求仍受 1 MiB Envelope 限制，大文件应使用可由 Server 拉取的 URL。

## 10. `temporary_files.read_urls`

第三方应用不能只提交 `file_ids`。请求必须同时指定应用有权访问的会话和消息：

```json
{
  "v": 1,
  "kind": "request",
  "id": "file-url-1",
  "method": "temporary_files.read_urls",
  "payload": {
    "conversation_id": "f967369f-9fd3-4058-92f0-b1960b5ea783",
    "message_id": "25347bdd-c500-4108-929b-423ca4d1067a",
    "file_ids": [
      "42d5d6f7-6bc5-46c8-bbe5-498a39f36981"
    ]
  }
}
```

Server 会依次校验：

1. 应用仍是该会话成员。
2. 消息属于该会话，并位于应用可见的历史范围内。
3. 每个 file ID 确实出现在该消息的 `file`、`image`、`voice` 或嵌套转发消息 body 中。
4. 临时文件仍存在且未过期。

成功响应 payload：

```json
{
  "urls": [
    {
      "file_id": "42d5d6f7-6bc5-46c8-bbe5-498a39f36981",
      "url": "https://assets.example.com/...signed...",
      "expires_at": "2026-07-17T06:10:00Z"
    }
  ]
}
```

签名 URL 最长有效 24 小时，并且不会超过临时文件自身剩余生命周期。不要长期保存签名 URL；需要访问时重新申请。

## 11. JavaScript 最小示例

以下示例使用 Node.js 的 `ws` 包：

```js
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const appId = process.env.MAGICCHAT_APP_ID;
const secret = process.env.MAGICCHAT_APP_SECRET;
const pending = new Map();
const ws = new WebSocket("wss://your-server.example.com/api/app/ws", {
  headers: {
    "X-MagicChat-App-ID": appId,
    Authorization: `Bearer ${secret}`,
  },
});

function request(method, payload) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ v: 1, kind: "request", id, method, payload }));
  });
}

ws.on("message", async (raw) => {
  const envelope = JSON.parse(raw.toString());

  if (envelope.kind === "response") {
    const callback = pending.get(envelope.reply_to);
    if (!callback) return;
    pending.delete(envelope.reply_to);
    if (envelope.ok) callback.resolve(envelope.payload);
    else callback.reject(new Error(`${envelope.error.code}: ${envelope.error.message}`));
    return;
  }

  if (envelope.kind !== "event" || envelope.event !== "message.created") return;

  // 先把 cursor 和业务处理结果持久化，再 ACK。
  console.log("message", envelope.payload.message);
  await request("message.send", {
    target: {
      type: envelope.payload.conversation.type,
      conversation_id: envelope.payload.conversation.id,
    },
    message: { type: "text", content: "消息已收到。" },
  });
  await request("events.ack", { cursor: envelope.cursor });
});

ws.on("close", () => {
  // 使用带退避和抖动的策略重连；未 ACK 事件会由 Server 重放。
  console.error("connection closed");
});
```

生产代码应维护 `request id -> Promise` 映射，按 `reply_to` 关联响应，并在 ACK 前确保事件已持久处理。若一次事件需要发送多条消息，每条 `message.send` 必须使用不同请求 ID，并等待所有响应成功后再决定是否 ACK。

## 12. Go 最小示例

以下示例使用 `github.com/gorilla/websocket`：

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Envelope struct {
	V       int             `json:"v"`
	Kind    string          `json:"kind"`
	ID      string          `json:"id,omitempty"`
	Cursor  int64           `json:"cursor,omitempty"`
	Event   string          `json:"event,omitempty"`
	ReplyTo string          `json:"reply_to,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func main() {
	header := http.Header{}
	header.Set("X-MagicChat-App-ID", os.Getenv("MAGICCHAT_APP_ID"))
	header.Set("Authorization", "Bearer "+os.Getenv("MAGICCHAT_APP_SECRET"))
	conn, _, err := websocket.DefaultDialer.Dial("wss://your-server.example.com/api/app/ws", header)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	for {
		var event Envelope
		if err := conn.ReadJSON(&event); err != nil {
			log.Fatal(err)
		}
		if event.Kind != "event" || event.Event != "message.created" {
			continue
		}

		// 此处先持久化并完成业务处理，再确认 cursor。
		ack := map[string]any{
			"v": 1, "kind": "request", "id": uuid.NewString(),
			"method": "events.ack",
			"payload": map[string]any{"cursor": event.Cursor},
		}
		if err := conn.WriteJSON(ack); err != nil {
			log.Fatal(err)
		}
	}
}
```

Gorilla WebSocket 不允许多个 goroutine 并发写同一连接。生产实现应使用单独的写循环或互斥锁串行发送请求，并加入重连、指数退避、请求超时、幂等和优雅停机处理。

## 13. 安全建议

- 将连接密钥保存在服务端密钥管理系统，通过环境变量或运行时注入使用。
- 密钥泄漏时立即调用重置接口；重置会关闭旧连接并使旧密钥失效。
- 不要把 App 密钥交给浏览器、移动端或不受控用户设备。建议由自己的后端服务连接 WebSocket。
- 对事件 cursor 和请求 ID 建立持久化幂等记录，避免重连或超时重试导致重复业务动作。
- 下载临时文件前仍应按自身业务做类型、大小和内容安全校验。
- 只记录必要的 Envelope 元数据，日志中不要写密钥、签名 URL 或敏感消息正文。
