# 通讯录分组与公开群设计

## 背景

客户端通讯录当前只展示用户联系人，应用和群组主要通过会话列表进入。新的通讯录需要成为统一入口，按分组展示智能体、联系人和群组，并支持公开群发现与加入。

## 目标

- 将客户端通讯录接口统一为 `GET /api/client/contacts`。
- 通讯录左侧按可折叠分组展示：应用、联系人、群组。
- 应用出现在通讯录中，并展示在线状态；当前版本应用在线状态固定为离线。
- 群聊默认私有，群主可以在群聊信息 sheet 中设置为公开群或取消公开。
- 公开群出现在通讯录的群组分组中，非成员用户可以加入。
- 公开群状态变化和用户主动加入公开群都需要产生系统消息。
- 群成员上限统一为 500 人。

## 非目标

- 不实现真实应用在线连接状态探测；前端和客户端 API 当前都按离线展示。
- 不在创建群聊流程中提供公开选项。
- 不改变现有私聊和普通邀请成员的核心流程。
- 不移除已有的会话列表入口。

## 数据模型

### 应用

复用现有 `apps` 表字段：

- `enabled`
- `visibility`
- `creator_user_id`
- `avatar`
- `description`
- `name`

应用进入通讯录的规则：

```text
enabled = true
AND (
  visibility = 'public'
  OR (visibility = 'creator' AND creator_user_id = 当前用户 ID)
)
```

应用响应中的 `online` 当前固定为 `false`。

### 群组

在 `conversations` 表增加群组可见性字段：

```text
visibility: private | public
```

规则：

- 默认值为 `private`。
- 只对 `kind = group` 的会话产生业务含义。
- `public` 群可以被所有用户在通讯录中看到并主动加入。
- `private` 群只对已在群内的成员可见。
- 已加入成员不受取消公开影响。

群成员上限改为 500 人。创建群聊、邀请成员和加入公开群都使用同一个上限。

## API 设计

### 读取通讯录

```http
GET /api/client/contacts
```

响应：

```json
{
  "success": true,
  "data": {
    "apps": [
      {
        "id": "app-id",
        "type": "app",
        "name": "AI 女菩萨",
        "avatar": "/assets/apps/assistant.webp",
        "description": "",
        "online": false
      }
    ],
    "users": [
      {
        "id": "user-id",
        "type": "user",
        "name": "张三",
        "nickname": "",
        "email": "user@example.com",
        "phone": "",
        "avatar": "/assets/avatars/builtin/01.webp",
        "last_online_at": null,
        "online": true
      }
    ],
    "groups": [
      {
        "id": "conversation-id",
        "type": "group",
        "name": "IM探索",
        "avatar": "",
        "member_count": 8,
        "visibility": "public",
        "joined": false
      }
    ]
  }
}
```

排序：

- 应用：名称升序，ID 兜底。
- 联系人：沿用当前用户通讯录排序，名称、邮箱、ID 升序。
- 群组：当前用户已加入的群优先，其次公开未加入群；组内按名称、ID 升序。

`/api/client/contacts/users` 不再作为前端主路径使用。为降低破坏面，保留兼容路由，但不再新增使用方。

### 打开应用会话

```http
POST /api/client/conversations/apps
```

请求：

```json
{
  "app_id": "app-id"
}
```

权限和规则：

- 应用必须启用。
- 应用必须对当前用户可见，规则与通讯录应用列表一致。
- 同一个用户和同一个应用只创建一个 app 会话。
- 已存在会话时直接返回已有会话。
- 新会话成员包含当前用户和应用。
- 创建应用会话不产生系统消息。

### 设置公开群

```http
POST /api/client/conversations/groups/:conversation_id/public
```

权限和规则：

- 当前用户必须是群主。
- 会话必须是 active group。
- 已经是公开群时幂等返回成功，不重复写系统消息。
- 成功后写入系统消息：`XX 将当前群设置为公开群`。
- 通知该群所有在线成员。

### 取消公开群

```http
POST /api/client/conversations/groups/:conversation_id/private
```

权限和规则：

- 当前用户必须是群主。
- 会话必须是 active group。
- 已经是私有群时幂等返回成功，不重复写系统消息。
- 成功后写入系统消息：`XX 取消了当前群的公开状态`。
- 通知该群所有在线成员。

### 加入公开群

```http
POST /api/client/conversations/groups/:conversation_id/join
```

权限和规则：

- 会话必须是 active group。
- 群必须是 public。
- 群人数不能超过 500 人。
- 当前用户已经在群中时幂等返回会话，不重复写系统消息。
- 当前用户曾退出群时允许重新加入，恢复成员记录。
- 成功加入后写入系统消息：`XXX 加入群聊`。
- 新成员的 `history_visible_from_seq` 从加入消息 seq 开始。
- 通知该群所有在线成员。

## 系统消息

新增两个系统事件类型：

- `group_visibility_changed`
- `group_member_joined`

展示形式沿用现有系统消息样式：灰色 badge，居中，不使用气泡。

客户端摘要：

- 设置公开：`XX 将当前群设置为公开群`
- 取消公开：`XX 取消了当前群的公开状态`
- 加入公开群：`XXX 加入群聊`

## 前端设计

### 数据层

`ClientDataProvider` 从 `GET /api/client/contacts` 加载通讯录，并保存：

- `contactApps`
- `contacts`
- `contactGroups`

保留现有 `contacts` 字段用于用户联系人，降低现有组件改动。新增类型：

- `ContactApp`
- `ContactGroup`

新增动作：

- `openAppConversation(appId)`
- `joinGroupConversation(conversationId)`
- `setGroupConversationPublic(conversationId)`
- `setGroupConversationPrivate(conversationId)`

### 通讯录页面

左侧是统一列表，按固定顺序分组：

1. 应用
2. 联系人
3. 群组

每组：

- 可折叠。
- 显示分组名称和数量。
- 搜索时仍保留分组结构，只过滤组内条目。
- 搜索无结果时显示空状态。

列表项：

- 应用：头像、名称、离线状态。
- 联系人：头像、显示名、在线状态。
- 群组：群头像、群名、公开群/成员数。

右侧详情：

- 应用：头像、名称、描述、状态、发消息按钮。
- 联系人：保留当前姓名、昵称、邮箱、手机和发消息按钮。
- 群组：头像、群名、人数、公开状态、发消息或加入群聊按钮。

群组按钮规则：

- `joined = true`：显示 `发消息`，点击打开群会话。
- `joined = false`：显示 `加入群聊`，点击调用加入 API，成功后跳转群会话。

应用按钮规则：

- 显示 `发消息`。
- 点击调用打开应用会话 API，成功后跳转到该应用会话。

### 群聊信息 Sheet

在群聊信息 sheet 中增加公开状态操作区：

- 当前用户是群主且群为私有：显示 `设置为公开群`。
- 当前用户是群主且群为公开：显示 `取消公开群`。
- 非群主只展示当前状态，不显示操作按钮。

点击操作按钮弹 `AlertDialog`：

- 设置公开提示：公开以后任何用户都可以在通讯录里看到并加入这个群。
- 取消公开提示：取消公开后，未加入用户将不能再从通讯录发现并加入这个群，已有成员不受影响。

确认后调用对应 API，成功后更新会话、刷新通讯录，并通过实时消息同步系统消息。

## 错误处理

- 通讯录加载失败：沿用现有联系人错误处理和刷新按钮。
- 加入群失败：展示 sonner 错误。
- 群人数超过 500：展示后端错误文案。
- 无权限公开/取消公开：展示无权限错误。
- 群已解散或不存在：展示错误，并刷新会话/通讯录数据。

## 测试计划

后端：

- `GET /api/client/contacts` 返回应用、用户和群组。
- 应用可见范围过滤正确。
- 私有群只对成员可见，公开群对所有用户可见。
- 群主可以设置公开和取消公开，非群主不能操作。
- 设置公开、取消公开、加入公开群产生正确系统消息。
- 加入公开群受 500 人上限约束。

前端：

- 创建群聊默认名称为“新建群聊”，不选择成员或应用也可以创建。
- 创建群聊可以分别选择联系人和应用。
- 通讯录按应用、联系人、群组三组展示。
- 搜索保留分组并过滤条目。
- 选择应用、联系人、群组时详情面板正确切换。
- 未加入公开群显示加入按钮，加入成功后跳转会话。
- 群主在群信息 sheet 中可以公开和取消公开群。

## 迁移与兼容

- 新增 migration，为 `conversations.visibility` 设置默认值 `private`。
- 已有群聊自动成为私有群。
- 已有会话列表不受影响。
- 前端切换到 `GET /api/client/contacts` 后，旧 `/api/client/contacts/users` 可以暂时保留，避免外部调用立即失效。
