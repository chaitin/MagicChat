# Desktop 与 Web 聊天能力差异清单

更新日期：2026-09-01

行为基线：`02189fe2`、`51d536b9`、`f849d57c`、`3e0a4982`、`73dc2b15`、`4797a7a4`。

本轮增量基线：`b67c30c`、`ee7207e`、`496e227`、`0f6149d`、`863789d`、
`53f19a9`、`d00796a`、`25457e1`。

本次 Desktop 同步基线：`ba53e63`（按 ID 用户目录、好友关系与实时资料）、
`7ec004c`（新朋友体验）、`ea2e64b`（好友私信授权）和 `6c5c5b8`（文档块编辑与
文档卡片），以及 `7937137`（表格行列操作）、`0ce029c`（图片预览缩放范围）、
`702178f` / `7869522`（目录资料展示）和 `60d926c` / `05ac871`（文档块手柄稳定性）。
本轮继续对齐 `052c9d8` / `01fdb24`（实时会话状态）、`96ba0b3`（文档工作区跨项目导航）
和 `30d23ce`（表格单元格粘贴类型保持），以及 `ecf153f`（用户昵称编辑策略实时更新）。
不迁移 Web 官网、Admin、Assistant 路由、`BroadcastChannel` 或浏览器新标签页行为。

## 本轮增量对照清单

- `ba53e63`：contacts 改为 `apps`、`directory_mode`、`groups`、`user_ids`；普通用户
  资料通过受控 `users/resolve` 批量补全，并提供好友搜索、申请、接受、拒绝、取消和删除。
  Desktop 对应 Renderer 内存目录、ClientData Provider、实时同步、通讯录和项目/任务资料
  hydration；保留旧 `users` contacts 响应的受限升级兼容，且不持久化或跨 Target 复用资料。
- `7ec004c`：好友入口升级为“新朋友”。Desktop 对应全局通讯录待处理提醒、friends
  通讯录的新朋友入口及数量、聊天新建菜单的添加好友入口，以及按时间合并待处理申请的单页对话框；
  资料页保留与当前 Web 一致的添加好友/等待接受状态，不保留好友列表标签或删除好友入口，
  但保留与 Web 相同的 `deleteFriend` 内部数据层契约。
- `ea2e64b`：friends 模式下 Server 对新建私信、全部消息发送、上传和转发强制好友关系。
  Desktop 对应保留 `direct_friendship_required` 403 的服务端消息、草稿/引用和重试行为，
  不在 Renderer 以本地通讯录缓存代替 Server 授权。
- `6c5c5b8`：文档支持块背景、inline code mark 互斥、块级插入/转换/颜色操作和文档卡片。
  Desktop 对应独立 Tiptap extension、编辑器样式、主窗口 `SendCardDialog` 与子窗口窄化卡片
  流程；保留 Hocuspocus Bridge、内部文档路由和子窗口不挂载聊天 Provider 的边界。

- `b67c30c`：聊天记录搜索与定位。Desktop 现状是本地搜索和连续消息缓存；目标为
  `client-api/search.ts`、`MessageManager` 独立 history snapshot、Provider、全局搜索和
  话题抽屉。保留 Desktop 持久缓存、原生 Dialog 和连续游标语义；验收覆盖隐藏会话、
  归档话题、双向分页、返回最新、请求取消和不推进已读/同步游标。
- `ee7207e`：统一语音输入。目标为 Desktop 自有 `voice-input-dialog.tsx`、录音 hook 和
  composer；保留 Main/Preload 安全边界。验收覆盖重录、发送语音/文本、识别失败降级和
  发送中防重复提交。
- `496e227`：群公告、撤回正文和图片缩略图。目标为会话/消息 DTO、normalizer、群信息、
  聊天面板公告、草稿恢复和消息操作；保留原生图片复制。验收覆盖权限、Unicode 200 字、
  清空确认、实时刷新、Markdown/提及恢复和旧缓存兼容。
- `0f6149d`：实时 ASR。目标为版本化 Shared Bridge、Main ASR Controller、Preload、PCM
  AudioWorklet、Renderer ASR 客户端及录音状态机；Renderer 不直接连接远端 WebSocket。
  验收覆盖认证目标隔离、背压、2 MiB 队列上限、生命周期清理和普通语音降级。
- `863789d`：图片动态范围。目标为 Renderer 全局图片样式；使用渐进增强，不增加脚本探测。
  验收覆盖支持与不支持 `dynamic-range-limit` 的平台。
- `53f19a9`：富消息紧凑布局。目标为文件、链接、卡片、合并转发及语音组件；保留原生下载、
  外链安全策略和键盘焦点。验收覆盖 320 px 上限、长文本和三档窗口。
- `d00796a`：M4A/AAC 与跨端语音摘要。目标为语音 normalizer、上传和摘要；保留受保护媒体
  transport。验收覆盖 WebM、真实 M4A/AAC-LC 和未知类型降级。
- `25457e1`：稳定语音播放。目标为 Desktop 单实例播放状态机、15 秒启动超时、失败重试和
  Object URL 清理；保留 seek 控件。验收覆盖首播、暂停/继续、切换、错误和卸载。
- 共享 HTTP 取消基础设施：不对应新增 Server 协议提交，服务于搜索、分页及所有受控
  `/api/client/*` 请求。复用 `desktop:v1:transport-cancel`，目标为 Renderer fetch adapter、
  Main pending registry 与宿主生命周期；不新增搜索专用通道或 Renderer 批量取消能力。

## 本轮已对齐

- 用户目录与脱敏 DTO：contacts 支持新旧协议；`users/resolve` 在当前 Renderer/认证 Target
  内按微任务合批、每批最多 100 条、TTL、负缓存、版本保护和清理策略工作。会话、消息、项目、
  任务和文档贡献者保留 ID 基础数据，资料未到达时显示稳定截短 ID，不将目录写入消息缓存或诊断。
- 用户实时资料：已安全处理 `user.profile.updated` 和 `user.presence.updated`。资料更新只刷新
  已缓存用户，在线状态只 patch 已缓存资料，畸形事件不会中断实时连接。
- 用户昵称策略：已处理 `user.nickname.policy.updated`。合法事件按服务端时间戳失效当前
  Renderer 内全部已缓存用户资料并刷新当前用户；畸形事件和单次刷新失败不会中断 realtime，
  组件卸载会清理订阅，后续 realtime ready 周期仍会执行目录补偿同步。
- 新朋友与好友目录：已支持 `organization`/`friends` 模式、精确用户搜索、申请生命周期、
  全局待处理提醒、通讯录/聊天一致入口及单页合并待处理申请。申请、关系和目录模式实时事件在
  全部主应用路由有界合并刷新，并在 realtime 重新就绪后补偿同步；联系人详情保留 Web 当前的
  添加好友/等待接受入口，删除好友 UI 已从 Desktop Renderer 移除。`deleteFriend` 的受控 API、
  Context 与 Provider mutation 保持与 Web 一致，但当前没有 Renderer 界面调用它；所有请求仍经
  Main/Preload 的既有受控 fetch。
- 好友私信授权：新建私信、文本、富文本、链接、卡片、文件、图片、语音和转发均保留 Server
  `direct_friendship_required` 403 的错误 envelope；失败不会伪造会话或消息成功状态，也不清空
  草稿或引用上下文。
- 文档跨端编辑：已支持 `blockBackgroundColor` 的 JSON/HTML/Yjs 保真、inline code 互斥、插入
  上下段落、块转换、段落背景、文字颜色和删除，以及嵌套列表、代码块与正文样式对齐。
- 文档卡片：主文档工作区使用受控会话选择与发送流程，文档子窗口使用独立窄化 dialog；两者都
  生成已编码内部路径，不打开外部浏览器或新增 Renderer 网络能力。
- 文档表格编辑：单元格悬停时提供行和列操作菜单，可在当前行/列前后插入或删除，并显示活动
  单元格反馈；单个表格单元格粘贴会保留目标位置的 `td`/`th` 类型，多单元格及表格外粘贴
  继续使用 Tiptap 默认行为；保持现有协作、表格创建、列宽调整和只读边界。
- 文档跨项目导航：主窗口复用 ClientData 项目页，独立文档窗口通过轻量数据上下文按最多 100 条
  分页加载；侧边栏项目选择器支持从所选项目打开或新建文档，同时保留独立文档窗口的一文档
  一窗口所有权和主窗口离开确认。
- 文档块手柄：活动块高亮由 ProseMirror decoration 管理并随事务映射位置，避免协作更新或 DOM
  重建后出现悬停高亮丢失；手柄的可点击区域和层级与表格控制件保持稳定。
- 图片预览：缩放范围与 Web 一致，支持 25% 至 400%，保留受保护资源 URL、滚轮缩放和拖动边界。
- 话题源消息资料：用户和应用发送者优先使用当前用户及 Desktop 内存目录的头像和显示名；资料
  未命中时才回退到消息 payload，不持久化或额外请求资料。

- 上游 `99073c0`：顶层普通文本和 Markdown 消息按真实高度折叠，多选模式显示全文，展开控制不触发消息选择或操作菜单。
- 上游 `2e23981`：文档图片、定制分割线、表格、多色高亮和新版待办 Schema 已注册；待办项通过 Desktop 独立 React NodeView 保持复选框与正文首行同行，并在只读状态阻止共享属性写入；安全粘贴、文档图片上传/解析、awareness 在线成员与协作光标、贡献者 DTO 和五个项目 section URL 已接入 Desktop 独立实现。
- 上游 `1cbcb75`：用户、群聊和应用资料字段以及表情参与者名称在窄窗口和无断点文本下可换行，资料内容超高时可纵向滚动。
- 跨端 Yjs 回归使用提交在 Desktop 测试目录的 `2e23981` 固定二进制样本；样本不是生产数据，日常测试和运行时均不读取 `client-web/src`。

- 核心文档 V1：项目页使用真实 `/api/client/*` 文档数据，支持文档/目录创建、重命名、
  级联删除、当前项目搜索、拖动排序、全屏懒加载工作区和窄窗口导航；正文通过
  Yjs/Hocuspocus 协作，标题使用权威 PATCH 并观察远端 `Y.Text("title")`。
- 文档编辑格式：支持标题一至三级、段落、粗体、斜体、下划线、删除线、颜色、链接、
  无序/有序/待办列表、引用、代码块、四种对齐、撤销/重做和块移动/转换/复制/删除。
- 文档工具栏交互：格式刷采用持续激活、目标选区释放自动应用和 Escape 取消；颜色/高亮使用
  10x5 色板并提供重置；链接菜单回填当前地址、补全裸域名并在提交后关闭；表格使用 10x10
  网格、悬停预览和方向键；对齐显示当前状态下拉菜单。工具栏在宽窗口居中，在窄窗口通过
  双层滚动轨道完整访问首尾控件；插入后的分割线可继续调整粗细和线型，表格显示选中/列宽
  反馈，图片和协作光标同步 Web 的关键展示状态。Desktop 保留 Tooltip、`no-drag`、自定义
  分割线和替代文本等端侧能力。
- 文档安全边界：Renderer 使用专用版本化二进制 Bridge，Main 持有 Cookie、Origin、系统
  代理和 TLS；帧、队列、会话数、owner/Target/文档所有权和清理路径均受限。
- 产品入口：主侧栏提供固定即应官网 HTTPS 入口并复用系统外链流程，不增加客户端下载弹窗。

- 会话置顶：桌面端支持右键置顶/取消置顶、置顶排序和实时状态同步。
- 实时会话状态：单聊和应用会话订阅有界 `conversation.status`，在标题与历史区展示输入/处理
  状态；状态 5 秒自动过期，同发送方消息到达或实时断线时清除。输入框仅在聚焦、窗口可见且
  连接就绪时每 3 秒发送“正在输入”心跳，切换会话后必须重新聚焦。
- 消息免打扰：桌面端支持右键开启/关闭、服务端状态保存和实时状态同步。
- 状态展示：置顶会话显示 Pin 小图标，免打扰会话显示 BellOff 小图标。
- 未读展示：免打扰会话有未读消息时显示红点，不再显示未读数字徽标。
- 原生通知：继续使用消息事件中的 `notification_muted` 抑制桌面系统通知。
- 图片说明：支持文本/Markdown 协议、5000 字输入、群聊提及、历史与实时渲染及会话摘要。
- 选择消息：支持快照追赶、幂等实时更新、`[选择]` 未读优先级、群聊票数可见性及转发/多选限制。
- 话题源消息：保留正文和表态，支持普通源消息转发/多选以及源选择消息回答，并处理删除、撤回和不支持状态。
- 文件消息：统一拒绝空文件和超过 500 MiB 的文件，Main 上传路径保留流式传输和消息级上限。Server、Web、Desktop、Mobile 的普通文件上传上限均已同步为 500 MiB，入口代理允许 501 MiB 请求体以容纳表单开销。
- 会话生命周期：支持确认后删除/隐藏普通会话，从联系人、群组或应用目录恢复会话，并幂等处理 `conversation.restored` 实时事件。
- 会话发现：支持综合/通讯录/对话全局搜索、拼音匹配，以及全部/未读/单聊/群聊筛选。
- 聊天记录搜索：综合和聊天记录范围通过 `/api/client/search/messages` 提供远端结果，支持
  500 ms 防抖、标准请求取消、错误重试、隐藏会话恢复、活动或归档话题打开及目标消息定位；
  文档和任务页签仍明确显示“待完善”。
- 应用外观：Desktop 浅色/深色主题 token、48 px 主导航、登录页、加载页和 Renderer 设置弹窗已同步 Web；仅保留 macOS 顶部窗口拖拽区。
- 消息操作：普通消息和话题源消息悬停时同步展示表态与“更多操作”，同时保留右键菜单、选择消息限制和 Desktop 既有复制能力。
- 字体：Desktop 与 Web 均使用 `HarmonyOS Sans SC` 正文字体和 `JetBrains Mono` 代码字体，并保持相同回退字体栈。
- 话题列表：按父会话分组、30 分钟活动规则展示参与话题，当前旧话题可强制包含，话题不提供置顶操作。
- 长历史：`MessageManager` 使用独立、有界的 history snapshot 展示目标附近消息，支持缓存
  优先、Server 校准、双向分页、目标居中高亮、实时新消息计数和返回最新；历史读取不会推进
  连续缓存游标或自动标记已读。
- 群公告：消费公告字段和实时系统事件，群主/管理员可编辑或确认清空，聊天面板支持三行截断
  与可访问展开；普通成员保持只读。
- 撤回重新编辑：仅使用 Server 提供的合法 `editable_body` 恢复文本或 Markdown、提及区间和
  编辑器焦点，不从旧缓存正文推断权限。
- 受控 HTTP 取消：所有 Desktop fetch adapter 请求通过既有 v1 cancel Bridge 映射标准
  `AbortSignal`；Main 按 WebContents owner、Server 和认证 Target 隔离，并在注销、删除
  Server、窗口销毁和退出时清理。
- 实时语音输入：统一弹窗支持录音、实时转写、修改文字、重录、发送语音或文字；ASR 失败
  不丢弃录音，转写经去空白后随 multipart 上传。
- 语音播放：接受 WebM 与 M4A 协议，提供单实例播放、seek、15 秒启动超时、媒体错误提示、
  重试、转写展开和 Object URL/定时器清理。
- 富消息展示：图片使用稳定缩略图框架和 `dynamic-range-limit: standard` 渐进增强；文件、
  链接、卡片、合并转发和语音保持 320 px 紧凑布局及原生宿主动作。
- 资源管理：群应用邀请限制为群主/管理员；应用所有者可在精确名称确认后删除自建应用，项目任务可在永久删除确认后从已加载视图移除。
- 应用资料：入口和错误文案统一为“开发指南”。

## 保留的差异与待验证项

- Web 在线图片输入和 HTML 粘贴允许浏览器直连 HTTP/HTTPS 图片；Desktop 只允许主动创建和加载 HTTPS 图片。共享 Yjs 中 Web 已写入的 HTTP 图片节点及属性会无损保留，但 Desktop 不发起请求、不删除、不改写也不自动升级协议，而是显示稳定的不可加载状态。
- 若未来需要 Desktop 加载 HTTP 图片，必须另立提案设计 Main 代理、用户确认、SSRF 防护、响应类型/大小限制和资源生命周期，不得放宽 Renderer CSP。
- `2e23981` 固定 Yjs 夹具只在 Web Schema 有意变化且指定新基线时显式重新生成并审查，不能改为测试运行时动态导入 Web 源码。

- 文档在 Desktop 当前窗口打开，保留 40px 原生拖拽区；Web 的新标签行为不迁移。
- 文档 HTTPS/HTTP 链接继续使用 Desktop 原生外链策略，不由编辑器直接打开。
- 导出、文档信息、全局文档搜索、Markdown/文件/脑图/表格和多实例 document-server 广播仍未实现，
  也不显示占位入口。文档卡片分享和受控文档子窗口已实现；它们不等同于浏览器多标签行为。
- 本次用户目录、好友与文档同步仍需连接兼容 Server 完成 contacts 新旧协议、仅 ID DTO、
  profile/presence、新朋友申请创建/处理、目录模式切换、realtime 重连和好友私信 403 联调；并需 Web/Desktop 双客户端验证
  块背景、inline code、块操作、文档卡片、权限撤销、断网重连和 Server 重启。
- 核心文档 V1 仍需完成三档窗口、多缩放及 macOS/Windows/Linux 真机验收。

- 全局搜索的键盘和可访问性行为由 Desktop 自有 Dialog 实现，视觉结构与页签状态已对齐 Web，未引入仅用于外观一致性的额外 Command 依赖。
- ASR 保持 Desktop 安全架构：Renderer 只采集 PCM 并调用窄化、版本化 Bridge；Main 使用
  不可变 `AuthenticatedTarget`、Session Cookie、系统代理和 TLS 信任链连接固定
  `/api/client/asr/realtime`，Renderer 无法指定 URL、Header、Cookie 或通用 WebSocket 数据。
- 图片继续使用 `magicchat-media://`/受控资源 URL 和原生复制；文件继续使用原生下载；HTTPS
  外链直接交给系统浏览器，HTTP 外链经用户确认后打开；语音保留 Desktop seek 控件。
- 通知架构保持端侧差异：Web 继续使用浏览器通知偏好；Desktop 使用系统通知权限、全局隐私设置和服务端免打扰状态，对应测试也按 Desktop 原生链路组织。
- 接近 500 MiB 文件的峰值内存、取消及失败清理仍需在打包应用连接兼容 Server 后实测。
- 1280x820、1024x640、760x560 三档窗口的浅色/深色主题、长文本、焦点、对话框、筛选、嵌套话题和活动上传仍需真机视觉验收。
- 新朋友导航提醒、通讯录徽标、聊天菜单和申请对话框在上述三档窗口的浅色/深色主题，及
  Windows、macOS、Linux 真机键盘焦点验收仍未完成。
- 跨客户端图片说明、选择消息重连、会话隐藏/恢复和破坏性操作仍需打包 Desktop 连接兼容 Server 的联调冒烟验收。

## 平台验收矩阵

- 自动化：协议、缓存、搜索、ASR Bridge/Controller、PCM 编码、语音上传/播放和资源清理已纳入
  Vitest；Renderer 边界检查确保未引入 Node/Electron 或 `client-web/src` 依赖。
- macOS：当前开发环境已完成自动化与生产构建验证；麦克风权限、真实 ASR、系统代理、
- 休眠/恢复及正式安装包 M4A 播放仍需人工记录；新朋友流程尚未在真机人工验收。
- Windows：正式安装包中的麦克风、ASR、代理、休眠/恢复和 M4A/AAC-LC 尚未人工验收。
- Linux：正式安装包中的麦克风、ASR、代理、休眠/恢复和 M4A/AAC-LC 尚未人工验收。
- M4A 预期：项目锁定 `electron@43.2.0`，官方 Electron 发行构建具备 proprietary codecs
  与 AAC/MP4 解码基础；这只构成预期能力。发布前必须使用 Server 接受的真实受保护
  M4A/AAC-LC 文件，在每个支持的操作系统和架构记录 Electron/Chromium、
  `canPlayType('audio/mp4; codecs="mp4a.40.2"')` 和首播、暂停/继续、seek、切换、失败重试、
  卸载的端到端结果。

## 回滚说明

- 群公告、`editable_body`、语音 `transcript` 和 `audio/mp4` 属于已生效的向后兼容协议消费；
  即使回滚 UI，也应保留 normalizer 和缓存兼容，避免合法 Server 数据再次降级。
- 搜索入口可临时关闭，但独立 history snapshot 和连续缓存游标不得混合；不要改回把不连续
  历史页面提交到 latest working set。
- ASR 可按 Shared/Preload/Main/Renderer 整体切片关闭，普通 MediaRecorder 语音发送必须继续
  可用；不得以 Renderer 直连远端 WebSocket 作为回滚替代。
- 展示样式和播放状态机可独立回滚，但受保护资源转换、原生图片复制、文件下载和外链安全
  策略必须保留。

## 明确不纳入本轮

- Web 中尚未形成完整产品能力的项目目标、文档和任务全局搜索功能不在本轮对齐范围内；
  Desktop 仅同步其“待完善”占位展示。

## 说明

Desktop Renderer 保持独立实现，不直接引用或运行时加载 `client-web` 源码。后续补齐差异时应继续按 API、状态、实时事件、UI 和测试逐层迁移。
