# Flutter 重构迁移矩阵

Flutter 工程与现有客户端并行演进，页面层通过 `MagicChatRepository` 访问数据，确保桌面和移动端共享同一套交互与状态模型。

| 现有能力 | Flutter 入口 | 状态 |
| --- | --- | --- |
| 登录、Server 会话 | 启动登录页、`AuthService`、`SessionStore`、设置页 | 密码/邮箱验证码登录、HTTP/Bearer、退出登录、服务器切换、实时连接清理、主题持久化已接入 |
| 账户资料 | 设置页 | `/api/client/me` 查询、昵称修改、头像选择及严格 256x256 WebP 裁剪上传已接入 |
| 多账户 | 设置页、`SessionStore` | 安全存储多个 Server 账户、切换和长按删除、需重新登录账户的密码认证 UI 已接入 |
| 本地存储 | 设置页、`StorageService` | 跨平台缓存占用统计、路径展示和清理已接入 |
| 私聊、群聊、应用会话 | 消息 → 会话 → 消息面板 | 私聊/群聊创建、应用会话打开、联系人打开会话、成员多选/添加/移除、群头像/公告/名称/公开状态修改、会话移除、话题创建、消息转发、消息面板和顶部历史分页已接入；成员角色权限管理待迁移 |
| WebSocket 实时同步 | `MagicChatRealtime`、`RealtimeSession`、`RealtimeStore` | cursor/envelope、退避重连、dispose、消息/会话事件幂等投影、消息视图监听及会话列表实时刷新已接入 |
| 联系人、在线状态 | 联系人 | `/api/client/contacts` 关键词查询、用户资料批量解析、在线状态展示、应用/群组打开会话已接入；`user.presence.updated` 实时投影已接入 |
| 聊天记录搜索 | AppBar 搜索 | `/api/client/search/messages` 已接入，支持跳转会话 |
| 会话管理 | 会话长按菜单 | 置顶、免打扰 API 与 UI 已接入；打开会话或停留在底部时按最新序号同步已读 |
| 推送授权与通知路由 | `PushService`、`PushTokenProvider`、设置页、`AppShell` | 私有 Server grant 注册/撤销、启动路由解析、通知总开关持久化、Android/iOS 通知权限声明及原生令牌桥接契约已接入；APNs/JPush 厂商 SDK 实现待补 |
| 二维码 | `QrScannerPage` | Android/iOS/macOS/Web 相机扫码、HTTP(S) 链接打开、文本结果展示及桌面粘贴兜底已接入 |
| 项目、任务视图 | 项目及任务抽屉 | 项目创建、编辑、删除、列表/看板/日历时间线/甘特、`/tasks`、任务创建、编辑（描述/负责人/状态/优先级/日期/标签/一次性与周期提醒）、状态更新、删除和评论已接入 |
| 文档协作 | 项目 → 文档、`DocumentRealtime`、`DocumentEditorPage` | 项目文档/目录列表、创建、创建目录、重命名、移动到根目录或其他目录和删除、编辑器界面（Markdown 编辑/预览、标题保存、本地草稿恢复）、二进制协作 WebSocket 桥接已接入；正文服务端协同持久化与协议帧解释待迁移 |
| 图片、文件、语音、选择、对象卡片、图表 | `_MessageBubble`、`flutter_markdown_plus`、文件选择器、`VoiceRecorder`、`_ChartPreview` | 文件选择与 multipart 发送、Markdown 渲染及链接、图片/音频按 MIME 分流、图片交互预览、附件打开/语音播放入口、麦克风录制发送、类型摘要、折线/柱状/饼图/雷达图专用预览、对象展开、图标和 choice 选项响应已接入 |
| 推送、系统通知、平台文件能力 | Flutter platform channels | 待按平台接入 |

## 迁移顺序

1. 先实现认证、HTTP 请求和 WebSocket 仓储，并复用服务端 `/api/client/` 协议。
2. 迁移消息分页、缓存、附件和消息类型渲染；以现有 mobile/desktop 测试作为行为基线。
3. 迁移通讯录、项目/任务、协作文档、推送和更新能力。
4. 在 Android、iOS、Windows、macOS、Linux 真机分别执行功能矩阵后，再替换旧客户端入口。
