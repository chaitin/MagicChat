# 桌面架构与安全模型

本文描述 Desktop 当前实现。正式发布前尚未落地的能力会明确标记为长期方案，不能
将其视为已经可用。

Stable OTA 校验 HTTPS、Stable SemVer、平台、架构、清单和安装包格式。官网清单只要求
`build`、`version` 和 `url`，下载不依赖文件大小或 SHA-512 字段。
Renderer 只接收 Main 归一化后的更新状态和纯文本发布说明，不接收构建签名状态、
GitHub Token、完整更新 URL、Header 或本地缓存路径；手动下载地址由 Main 根据固定仓库
`ptonlix/MagicChat` 生成。

## 进程与代码边界

```text
独立 React Renderer
        │ DesktopBridge v1
        ▼
      Preload
        │ 白名单 IPC
        ▼
Electron Main ── HTTP/WebSocket ── MagicChat Server
        │
        └── 文件、通知、权限、剪贴板、更新和系统窗口
```

文档协作使用独立的 `desktop:v1:document-collaboration-*` Bridge，不复用普通 JSON
realtime 通道。Renderer 只能提交不可变认证目标、文档 UUID、不透明 sessionId 和二进制帧；
不能提交 URL、Origin、Cookie、Header、代理或通用 WebSocket 参数。Main 从已保存 Server
构造固定 `/api/client/document/collaboration` WSS 地址，持有目标 Electron Session Cookie、
HTTPS Origin、系统代理和 TLS 信任链，并校验 Hocuspocus 帧中的文档路由名与 session 绑定
UUID 一致。

单个文档协作帧上限为 16 MiB，单会话待发送队列上限为 32 MiB，每个 WebContents 最多
8 个文档会话。IPC 两侧复制 `Uint8Array`，会话按 owner、不可变 targetKey、文档 ID 和
sessionId 隔离；页面卸载、WebContents 销毁、注销、认证失效、Server 删除、Target 切换、
休眠和应用退出都会幂等关闭对应 socket 并释放队列、监听器和定时器。Main 不建立自动重连，
退避重连只由 Hocuspocus Provider 负责。

文档协作日志不得包含 Cookie、认证 Header、标题、正文、Yjs 帧、完整 URL 或本地路径；
错误只向 Renderer 返回稳定作用域。document-server 4403 只表示当前文档权限失败，Desktop
不会据此注销整个账户；只有统一 HTTP 401 认证控制器确认 Target 失效时才清理全局会话。

- `src/main` 持有 Server Profile、Electron Session、Cookie、HTTP、WebSocket、
  文件、通知、更新、深链接和安全存储。
- `src/preload` 只暴露 `DesktopBridge v1`，不向 Renderer 提供 `ipcRenderer`、Node
  或 Electron 对象。
- `src/renderer` 是本地打包的独立 React 应用，启用 context isolation、sandbox
  和 webSecurity，不读取 `client-web` 的源码或资源。
- `src/shared` 只存放进程间契约，不承载页面或平台业务实现。

生产 Renderer 从 `magicchat-app://app/` 加载。主窗口拒绝远程导航和任意新窗口，
工作区中的外部 HTTPS 链接通过 Bridge 直接交给系统浏览器；HTTP 链接必须先由 Renderer
展示目标地址和未加密风险，用户确认后再打开。Main 仍会校验协议，主窗口拒绝绕过统一
外链流程的远程导航和任意新窗口。CSP 禁止远程脚本、对象、Frame 和 Renderer 直接发起
任意网络连接。外部 HTTP 图片仍不得自动加载。

Desktop 在统一外链入口中会额外识别当前不可变认证 Target 下的 HTTPS 文档链接。只有协议、
主机、端口、部署路径与已保存的 `normalizedUrl` 完整匹配，且路径严格为
`/documents/document/<document UUID>`、不含查询、片段、凭据或额外路径段时，Renderer 才会
通过 `DesktopBridge.navigation.openDocumentWindow(documentId, serverId)` 请求创建或聚焦文档
窗口。该分类只决定交互，不承担权限边界；Main 仍验证可信发送方、已保存 Profile、当前用户、
Target、UUID、窗口所有权和窗口上限。其他 Server、其他 Web 路由、HTTP 或无法无歧义解析的
链接继续执行既有外链规则；已开始文档交接但窗口服务失败时显示稳定错误，不静默回退系统浏览器。

## 文档独立窗口

Desktop 文档窗口是由 Main 创建的独立顶层 `BrowserWindow`，主窗口仍负责聊天、通知、托盘和
角标。Renderer 只能通过 `DesktopBridge.navigation.openDocumentWindow(documentId, serverId)`
请求打开窗口；Preload 不暴露通用 URL、BrowserWindow、窗口选项或任意 IPC channel。

窗口请求必须经过可信 IPC sender 校验，并绑定已保存的 Server Profile、当前 `lastUserId` 和
文档 UUID。Main 使用 `serverId + userId + documentId` 建立幂等索引，同一认证 Target 最多
打开 8 个文档窗口；重复请求等待同一首屏加载结果，成功后才聚焦已有窗口。子窗口使用与主窗口一致的 preload、context
isolation、sandbox、webSecurity 和 CSP，并且只加载带有 `serverId`、`window=document` 的
本地 `magicchat-app://app/` 路由。远程导航、任意新窗口和伪造 Origin、Header、Cookie、脚本
均在 Main/Preload 边界拒绝。

文档窗口身份在创建后固定绑定单个 `serverId + userId + documentId`，不允许在原窗口内切换
到其他文档。子窗口侧边栏选择或新建其他文档时，只能通过同一窄 Bridge 创建或聚焦目标文档
窗口，当前窗口路由保持不变，确保 Main 索引、导航白名单、协作 owner 和状态键始终一致。

开发模式的文档窗口复用受控的 Vite Renderer 地址；生产模式的本地协议在 SPA 路由回退时将
Renderer 入口资源规范化到协议根路径，确保带文档路由的 URL 不会把 JS/CSS 解析到
`documents/document/assets` 等不存在的目录。

文档子窗口使用专用的文档认证/数据宿主，只加载当前用户、项目和文档数据，并复用文档 REST、
Yjs/Hocuspocus、标题保存和离开保护；它不挂载聊天 `ClientDataProvider`、普通 realtime、
聊天事件同步、消息通知同步、聊天轮询、托盘消息或角标更新。文档协作仍通过现有
`document-collaboration-controller`，每个子窗口使用独立 WebContents owner；关闭、崩溃、加载
失败、WebContents 销毁、401、注销、账号切换、Server Profile 删除和应用退出都会幂等清理对应
owner 的协作 session、队列和监听器，不影响其他 Server 的窗口。普通应用退出会先请求所有文档
窗口执行现有未同步关闭确认；用户取消时终止退出并保留窗口，确认后才进入不可逆资源清理。
OTA 安装也在调用平台安装退出前完成同一确认，避免更新流程绕过未同步保护。
移除 Server Profile 前只协商关闭该 Server 的文档窗口；用户取消时终止移除且不清理 Session、
凭据或缓存，确认后等待最终窗口状态写入，再删除该 Server 下所有账号和文档的窗口状态。

窗口状态仅持久化按认证 Target/文档隔离的 bounds 和显示器元数据，使用最小 `760x560`。移动
和缩放事件采用防抖写入并在关闭时刷新最终状态；恢复时优先使用仍存在的已保存显示器，并按其
workArea 夹紧，显示器拔除或完全离屏才回退到主窗口所在显示器的默认位置。状态文件不保存正文、
标题、消息、凭据、Cookie、Token 或完整 URL。该方案不新增 Server API、数据库、文档协作协议
或迁移，也不提供同一窗口内的聊天/文档分屏；普通文档链接仍在当前窗口导航，需要并行聊天时
通过受控入口再次打开独立文档窗口。

普通退出和 OTA 安装会在关闭文档窗口后等待最终 bounds 写入队列完成，再进入不可逆资源清理。
文档窗口创建时使用当前原生深浅色主题，并与主窗口一起响应后续主题切换，避免深色模式下出现
白色背景闪烁或系统窗口控制键对比度不足。

## Renderer 独立策略

Desktop 首轮功能以 `client-web` 提交
`e1998bd852ad9bc7feff11355ed47b7889cb7887` 为一次性冻结来源。完成迁移后：

- Web 与 Desktop 的页面、交互和平台能力分别演进，禁止用 Web 目录整体覆盖 Desktop。
- `@/*` 指向 `src/renderer`，`@main/*`、`@preload/*`、`@shared/*` 分别对应
  Electron 三层及其跨进程契约；跨层导入不得使用 `../` 穿越目录。
- `publicDir` 只指向 `client-desktop/public`。
- `pnpm verify:boundaries` 禁止 Web 内部路径和 `client-core` 运行时依赖。
- 暂不建立公共运行时包。纯 DTO、协议归一化或消息转换只有在至少两次跨端一致修改、
  且不依赖 DOM/Electron 后，才另行评估抽取。

当前 UI 只允许用户填写和使用一个 Server，不提供多服务器切换。底层 Profile 和
Session 仍使用 Server ID 隔离，以保证移除服务器时可以定向清理 Cookie、连接、
缓存、临时文件和凭据。

## 网络与会话

每个 Server ID 使用独立的 `persist:magicchat-server-<id>` Session partition。
Main 只接受已保存的 Server 以及相对 `/api/client/` 路径，并限制请求方法、Header、
超时和响应大小。Cookie 和认证材料不返回 Renderer。

匿名 Target 仅能调用精确的只读启动接口和登录接口：`GET /api/client/info`、
`GET /api/client/me` 以及固定的账号/邮箱验证码登录 POST。资料修改、头像上传、注销和其他
业务接口必须匹配 Profile 当前不可变用户 Target，不能用匿名或旧用户 Target 借用 Session Cookie。

受认证头像、消息图片和音频通过 `magicchat-media://` 读取。Main 使用对应 Server
Session 请求资源并过滤响应 Header；Renderer 不拼接认证 Header，也不能读取 Cookie。
HTTP、WebSocket、文件、通知、权限、剪贴板、更新和外链都通过窄类型 Bridge，参数
在 Main 再次校验。

Updater 资格由 Main 根据打包状态、Stable 通道、平台、架构和可信安装来源决定：Windows
NSIS、macOS 打包应用和 Linux AppImage 可以进入 OTA；Linux deb、开发运行和 test 通道
只进入手动升级；未知平台或架构进入不支持状态。更新检查和下载采用单飞 Promise，远端
发布说明会移除 HTML、控制字符和 URL，并限制长度。安装前必须确认更新已下载且不存在
活跃文件传输，再由 Main 协调资源清理和一次性退出安装意图。安装意图只在 Main 的
`userData` 中保存目标版本和 build；新 schema 安装意图只有在首个 Renderer 加载并完成健康
标记后，才会在自身版本和 build 都严格匹配目标时删除更新缓存。旧 schema 1 意图继续按版本
匹配完成一次兼容清理。安装、版本/build 匹配或缓存删除任一环节不确定时保留缓存；缓存删除失败
保留安装意图，后续健康启动重试。设置页手动清理更新缓存
会同时删除安装意图，且 Renderer 不会获得本地路径或新增的更新清理 IPC。

Stable OTA 只使用数字 build 判断更新：远端平台 build 大于包内 `desktopBuild` 时提供更新，
否则不更新，SemVer 不参与比较。正式 Desktop build 由 CI 根据已有正式 Tag 自动取 max+1，跨 SemVer 递增；Android 和 iOS build 独立维护，公开资产名称和官网固定文件名不包含 build。

开发环境仅允许 localhost HTTP；打包应用只接受 HTTPS/WSS 和系统信任链。目前不支持
忽略证书错误、应用内导入私有 CA 或 mTLS。网络使用 Electron/Chromium 系统代理，
代理凭据不得写入普通配置。

## 第三方认证

当前 POC 使用受限的内嵌 `BrowserWindow`：

```text
Renderer 请求登录
  -> Main 使用当前 Server 的持久 Session 打开认证窗口
  -> 调用现有 /api/client/auth/third-party/:key/start?redirect=/init
  -> 返回 /init 后通过 /api/client/me 验证会话
  -> 关闭认证窗口并通知 Renderer
```

当前流程不调用 Desktop transaction、callback 和 exchange 三个 handoff 接口。
认证窗口只允许 HTTPS 以及开发环境的 localhost HTTP 导航，禁止下载和新建窗口，
并与普通 Renderer 保持进程和权限隔离。

长期正式方案仍是“系统浏览器 + Desktop handoff”：Server 使用 state/PKCE，完成认证
后生成短时单次 code，通过 `magicchat://auth/callback` 交给 Main 兑换 HttpOnly Cookie。
该方案启用前必须完成服务端接口、深链接校验和三平台协议注册验收。

## 本地数据与诊断

POC 不启用远程崩溃遥测，`crashReporter.uploadToServer=false`，也不接入 Sentry、远程
日志或行为分析。诊断包只能由用户主动导出，使用字段白名单，不包含 Server 地址、消息、
文件路径、完整 URL、Header、Cookie、Token 或原始 dump。设置页仅通过受信 Bridge 显示
实时诊断日志的聚合大小和可用状态；用户明确确认后可清理未导出的当前、轮转和兼容日志，
不会删除已导出的诊断包、消息缓存或其他应用数据。专用实时连接、会话列表和消息
追赶诊断事件可以在 `context` 中保存经过长度和字符集校验的 `conversationId`，以关联同一
会话的客户端阶段；这项例外不适用于消息缓存服务自身日志、缓存诊断字段或消息 payload，
后者仍不得保存身份标识。

消息缓存位于 Electron `userData/message-cache/messages-v1.sqlite3`，由 Main 管理的专用
Worker 使用 Node.js 内置 `node:sqlite` 独占访问。Renderer 只能通过版本化的
`DesktopBridge.messageCache` 执行有界分页、事务提交、状态查询和定向清理，不能获得
数据库路径、SQL、Worker 或 Node.js 能力。数据库使用 WAL 和从首版建立的连续
`user_version` 迁移注册表，
按 Server/用户/会话隔离和 generation 防迟到写入；POSIX 目录与文件权限分别限制为
`0700`、`0600`，Windows 依赖当前用户的 `userData` ACL。

空数据库与旧版本数据库使用同一条逐级迁移路径。迁移注册表必须从版本 1 连续登记到当前
支持版本；重复、缺失、乱序或目标版本未登记会在修改数据库前失败。所有待执行迁移、逐级
`user_version` 更新和 payload schema 校准位于同一个独占事务中，失败时整体回滚；已经发布
的旧迁移不得改写，只能追加更高版本。

数据库无法打开、schema 过高或迁移失败时，Worker 会先关闭失败连接，按 WAL、SHM、
主数据库的顺序临时改名，为同一路径的新库让位；任一步失败都会逆序恢复本轮已移动文件。
临时隔离文件不作为恢复源、诊断产物或备份：
新库完成 schema 初始化和权限设置后立即删除；Worker 每次启动及会话、用户、Server、
孤立 Server 和全量消息缓存清理时也会清扫旧版本或异常中断遗留文件。清扫只匹配固定
数据库 basename 和纯数字时间戳，不能访问任意路径或误删其他业务文件。恢复成功后若
仍无法删除临时文件，缓存进入内存降级，不得在保留明文副本时报告可用。

历史缓存页同时携带完整性状态。Main 删除无法解析的记录或 Renderer 拒绝核心结构不一致的
记录后，可以保留同页其他有效消息用于展示，但该页不能作为完整缓存命中，必须从原始
`beforeSeq` 回源 Server 补齐，避免损坏记录形成永久历史缺口。

与 Mobile 普通 `expo-sqlite` 缓存一致，消息 SQLite 不使用 SQLCipher 或应用级静态加密，
正文在本机以明文数据库形式存在。其保护边界是操作系统账户、应用数据目录权限和系统磁盘
加密。日志、崩溃记录与诊断导出不得包含消息 payload、身份 ID、Server URL、数据库路径、
SQL 参数或原始 SQLite 错误；设置页只展示近似逻辑占用、稳定状态和定向清理操作。

该缓存只保存规范化消息 JSON 与附件引用，不保存图片、语音、文件二进制。它也不提供完整
冷启动离线工作区：当前用户、联系人、会话摘要和项目 bootstrap 仍依赖 Server；完全离线
启动继续进入现有失败与重试流程。用户清理消息缓存不会删除服务端消息、认证、草稿、主题、
设置、下载或附件资源。

运行时持久写入失败后，当前 `MessageManager` 生命周期会单向切换为内存模式，不再读取、
写入或自动恢复 SQLite，避免把故障期间仅存在于 Renderer 的游标误判为已持久化。在线聊天
和实时消息继续工作，显式隐私清理仍由 Main 执行；应用重启后由新的 Worker、持久游标和
Server 重新建立可信同步边界。

## 跨端变更规则

### 2026-08 上游聊天与 Markdown 能力对齐

以下能力以 Server 提交 `955c80b`、`8f4eda6`、`1e8c757`、`6532ca3`、`b89b554` 为协议和
授权事实来源。Desktop 只消费既有受控 HTTP、文档协作和受保护媒体能力，不复制、引用或
运行时加载 `client-web`。

- 好友建立系统消息：Desktop 已支持 `friendship_created` 的归一化、固定摘要和实时会话
  刷新；Server 与 Web 已提供；Mobile 未在本轮 Desktop 变更中修改或验证。
- Markdown 协同文档：Desktop 已支持显式创建、`document_type: "markdown"`、路由级
  CodeMirror 工作区和 `Y.Text("markdown")` 协作；Server 与 Web 已提供；Mobile 尚未在本轮
  变更范围实现或验证该工作区。
- 会话话题浏览：Desktop 已支持非话题父会话的有界游标分页、状态和未读展示，以及复用既有
  话题导航；Server 与 Web 已提供；Mobile 未在本轮 Desktop 变更中修改或验证。
- 历史附件浏览：Desktop 已支持非话题会话的有界游标分页，并复用 `magicchat-media://` 和
  Main 下载链路；Server 与 Web 已提供；Mobile 未在本轮 Desktop 变更中修改或验证。
- 普通成员改群名：Desktop 已将群名编辑入口扩展到 active `member`，最终授权仍由 Server
  决定，其他群管理权限保持不变；Server 与 Web 已提供；Mobile 未在本轮 Desktop 变更中修改
  或验证。

本轮未改动 Shared、Preload、Main 或 DesktopBridge：既有版本化窄文档协作 Bridge 已覆盖
Markdown 共享文本，保持原有 sender、AuthenticatedTarget、owner 和资源清理校验。

修改以下内容时，必须分别核对 Server、Web、Desktop 和 Mobile，并记录哪些端已修改、
不受影响或尚未实现：

1. API 路径、字段、状态码、错误码和分页语义。
2. 登录、Cookie、第三方认证、注销、深链接和会话失效。
3. 角色、权限、资源归属和客户端可见性。
4. 实时协议、事件、游标、重连和 `system.ready`。
5. 文件、资源 URL、外链、重定向和不可信内容过滤。

安全和协议必须保持一致，页面布局、组件结构及平台交互可以独立实现。消息分区变更
仍需同时核对 `server/internal/store/message_partitions.go` 和
`server/docs/message-partitions.md`。
