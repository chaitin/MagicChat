# MagicChat Desktop 开发规范

## 1. 适用范围与原则

- 本文件适用于 `client-desktop/` 下的全部源码、测试、脚本、文档和构建配置。
- 先阅读 `README.md`、`docs/architecture-security.md`；涉及打包、更新或发布时，再阅读
  `docs/release-recovery.md`。
- `client-desktop` 是独立的 Electron 桌面客户端，不是 `client/web` 的壳。禁止直接引用、
  符号链接、运行时加载或整体复制 `client/web` 的源码和资源。
- 优先做范围最小、边界清晰、可验证的修改。不得提交占位实现、静默降级、安全绕过、
  未说明的兼容分支或与任务无关的重构。
- 用户界面、错误提示、代码注释和项目文档默认使用中文；协议字段、外部 API 名称及已有
  英文专有名词保持原样。
- 当前项目使用 Node.js 24、pnpm 11.1.3、Electron 43、React 19、TypeScript 6、
  electron-vite 5、Tailwind CSS 4 和 Vitest 4。依赖版本以 `package.json` 和锁文件为准，
  不凭经验替换或升级。

## 2. 目录与进程边界

```text
src/main/       Electron Main：可信系统能力、网络、会话、持久化和安全校验
src/preload/    DesktopBridge 的最小暴露层
src/renderer/   独立 React UI、页面、组件、状态、数据适配和样式
src/shared/     跨进程 DTO、IPC 名称和纯契约
tests/          跨模块契约、安全及基础设施测试
scripts/        构建、边界和产物验证脚本
docs/           架构安全、发布验收与恢复文档
public/         Desktop 自有静态资源
```

- `src/main` 可以使用 Node.js 和 Electron API；负责 Cookie、凭据、Server Session、
  HTTP/WebSocket、文件、通知、权限、剪贴板、外链、更新、窗口和深链接。
- `src/preload` 只能通过 `contextBridge` 暴露版本化、窄类型的 `DesktopBridge`。禁止暴露
  `ipcRenderer`、Node/Electron 对象、任意 channel 调用器或通用文件/命令执行能力。
- `src/renderer` 按不可信 Web 内容处理：不得导入 Node/Electron API，不得读取 Cookie、
  Token 或凭据，不得绕过 Bridge 直接访问后端、文件系统或系统能力。
- `src/shared` 只放跨进程契约及不依赖运行环境的类型，不放页面状态、Main 服务实现、
  Electron 实例或 DOM 逻辑。
- 使用 `@/*`、`@main/*`、`@preload/*`、`@shared/*` 别名表达边界。跨层导入不得通过
  `../` 穿越目录；同一小目录内可以使用相对导入。
- 不建立新的跨端公共运行时包。仅当纯 DTO、协议归一化或消息转换至少发生两次跨端一致
  修改，且完全不依赖 DOM/Electron 时，才评估抽取。

## 3. Electron 与安全规范

- 主窗口必须保持 `contextIsolation`、`sandbox`、`webSecurity` 等既有安全选项，不得开启
  Node integration、关闭证书校验或放宽远程内容执行权限。
- 生产 Renderer 只从 `magicchat-app://app/` 加载。开发地址固定为
  `http://localhost:20050`，必须保留 `strictPort: true`，不得静默换端口。
- 保持现有 CSP：禁止远程脚本、对象、Frame 和 Renderer 任意联网。不得用新增域名白名单
  掩盖架构问题。
- 所有 IPC channel 在 `src/shared/bridge.ts` 中集中定义并包含版本前缀。新增或修改能力时，
  必须同步更新契约、preload、Main handler、Renderer 类型声明及相关测试。
- Main 必须把所有 IPC 入参视为不可信数据，逐字段验证类型、长度、枚举、协议、路径、
  ID 格式、大小和资源归属；不能只依赖 TypeScript 类型断言或 Renderer 校验。
- IPC handler 必须验证发送方来自受信任 Renderer。订阅型 API 必须返回取消订阅函数；
  WebContents 销毁时要释放请求、上传、文件句柄和监听器。
- 外部 HTTPS 链接通过 Bridge 直接交给系统浏览器；HTTP 链接必须先在 Renderer 展示目标
  地址和未加密风险，并由用户确认后再打开。Main 必须再次校验协议，主窗口拒绝绕过统一
  外链流程的任意导航、新窗口、下载和权限请求；其他协议例外必须精确白名单并增加安全测试。
- 打包应用只接受 HTTPS/WSS 和系统信任链；仅开发构建可连接 localhost HTTP。禁止加入
  “忽略证书错误”、私有 CA 导入或 mTLS 的伪支持。
- Cookie、Token、代理密码、认证回调 code、消息正文、完整 URL、Header、文件路径和
  Server 地址不得写入普通配置、日志、遥测或诊断导出。凭据必须走既有安全存储。
- 文件传输采用流式处理并设置大小、路径和所有者限制；禁止将大文件整体放入单次 IPC，
  也不得让 Main/Renderer 内存随文件大小线性增长。

## 4. Server、认证与数据访问

- 当前 UI 只支持一个用户选择的 Server，不新增多服务器管理入口。底层仍必须按
  `serverId` 隔离 Profile、Session、Cookie、连接、缓存、临时文件和凭据。
- 受认证操作必须使用不可变的 `AuthenticatedTarget`（Server ID、规范化 URL、用户 ID），
  不得仅依赖可变的当前 Server 选择状态。
- Renderer 的业务请求统一经现有 client API/data API 和 Desktop transport 进入 Bridge；
  不在组件内拼 URL、认证 Header、错误协议或分页规则。
- Main 只接受已保存的 Server 和相对 `/api/client/` 路径，并继续限制方法、Header、超时、
  重定向和响应大小。不得允许 Renderer 提交任意绝对 URL。
- 头像、消息图片、语音等受保护资源使用 `magicchat-media://` 和现有资源 URL 适配逻辑；
  Renderer 不直接下载认证资源或读取 Cookie。
- 注销、401、远端会话失效必须协调停止 WebSocket、取消请求、清理对应用户缓存与状态，
  不得只跳转登录页。
- 实时连接必须遵守既有 envelope、cursor、重连和 `system.ready` 语义。事件处理应幂等，
  能容忍重复、乱序、网络切换、休眠唤醒及 Server 重启。
- 第三方认证当前是受限的独立认证窗口。不得把尚未实现的系统浏览器 handoff、PKCE 或
  deep-link exchange 当作已可用能力；切换方案必须同步完成服务端接口和三平台验收。

## 5. TypeScript 与实现风格

- 保持 `strict`，禁止用 `any`、`@ts-ignore`、非空断言或宽泛类型断言掩盖设计问题；确有
  外部不可信输入时先接收为 `unknown`，再显式收窄和校验。
- 沿用现有格式：双引号、无分号、尾逗号、两空格缩进；交给 TypeScript/Vite 处理模块，
  不手写生成物。
- 代码质量统一通过项目脚本执行：`pnpm format -- <文件...>` 格式化本次修改文件，
  `pnpm format:check -- <文件...>` 检查其格式，`pnpm lint` 负责静态规则，`pnpm check`
  统一执行 ESLint、TypeScript 和 Renderer 边界检查。不要绕过或局部关闭规则；确需例外时
  应限制到最小代码范围并写明原因。
- 类型优先使用不可变数据：跨进程 DTO 和只读返回值使用 `Readonly` / `ReadonlyArray`。
  共享契约变更要考虑向前/向后兼容，并在需要时升级 Bridge 版本。
- 函数和模块保持单一职责；纯转换、校验和展示规则从 React 组件或 Electron handler 中抽出，
  便于单元测试。只在消除真实重复或隔离复杂边界时增加抽象。
- 异步资源必须有明确生命周期：使用 `try/finally`、取消信号、超时或 dispose/unsubscribe；
  不遗留悬空 Promise、定时器、监听器、流和临时文件。
- 错误应在合适层级转为稳定、可展示的信息，同时保留可诊断的错误码；不得吞掉异常，
  也不得向 Renderer 泄露敏感底层信息。
- 不编辑 `out/`、`dist/`、`node_modules/` 或自动生成的 builder 配置。静态资源放入
  `public/` 或 Renderer 自有资源目录，不从 Web 目录复用路径。

## 6. Renderer 与交互规范

- 页面负责路由和功能编排；可复用业务 UI 放 `components/`，基础组件放
  `components/ui/`，纯规则与 API 适配放 `lib/`，可复用状态行为放 `hooks/`。
- 优先复用现有 UI 组件、Base UI/Radix 行为、Tailwind token、`cn()` 和 `lucide-react`；
  不引入第二套组件库、图标库或样式系统。
- UI 是工作型聊天客户端：保持信息密度、稳定布局和克制视觉，不添加营销式 Hero、装饰性
  卡片堆叠、渐变光斑或无功能动画。卡片圆角不超过现有设计系统约定。
- 图标按钮优先使用熟悉的 Lucide 图标，并提供可访问名称或 Tooltip；纯装饰图标设置
  `aria-hidden="true"`。表单控件必须有可关联的 Label。
- 交互应支持键盘、焦点可见、正确语义和读屏。测试优先按 role/name/label 查询，只有缺少
  稳定语义时才使用 `data-testid`。
- 所有异步界面都要覆盖加载、空、成功、失败、禁用和取消状态，避免重复提交；破坏性操作
  必须有明确确认和错误恢复路径。
- 固定格式区域应使用稳定尺寸、`min-width: 0`、`min-height: 0`、overflow 和响应式约束，
  防止文本、图标或动态内容导致布局跳动、溢出和遮挡。
- 保持浅色/深色主题以及 `prefers-reduced-motion` 支持。新增动效不得妨碍操作，且必须提供
  reduced-motion 降级。
- 涉及长列表、聊天历史或大数据集时使用既有虚拟列表/分段刷新模式，避免整表重渲染、
  无界缓存和主线程长任务。
- 桌面窗口可拖拽区域与交互控件必须正确区分；按钮、输入框、菜单等交互元素应保持
  `-webkit-app-region: no-drag`。
- 视觉变更至少检查 1280x820、1024x640、760x560，覆盖浅色、深色、文字溢出、焦点、
  系统缩放和关键弹窗；不得通过隐藏必要功能来适配小窗口。

## 7. 测试规范

- 使用 Vitest；Renderer 行为测试使用 Testing Library、`userEvent` 和可访问查询，避免测试
  React 内部实现、私有状态或脆弱 DOM 层级。
- 测试文件与实现邻近，命名为 `*.test.ts` / `*.test.tsx`；跨层契约、安全和基础设施测试
  可以放在 `tests/`。
- 修复缺陷必须先增加能复现问题的回归测试；新增功能至少覆盖主路径、失败路径和关键边界。
- Main/Preload/IPC 改动应覆盖：不可信入参、发送方校验、协议/路径限制、资源清理和敏感
  信息不泄漏。Bridge 改动应覆盖契约、preload 暴露和 handler 注册的一致性。
- Renderer 改动应覆盖用户可观察行为、键盘/焦点、加载/错误/空状态，以及权限或会话失效。
- 测试必须隔离全局状态并在每例后清理 mock、DOM、storage、监听器、定时器和临时目录；
  不访问真实网络、真实账号、系统密钥或生产服务。
- 不在文档或断言中固化测试文件总数。测试总量以当前流水线输出为准。

## 8. 验证命令

所有命令从 `client-desktop/` 执行。单项测试应尽量控制在 60 秒内。

```bash
# 开发
pnpm install --frozen-lockfile
pnpm dev

# 快速验证
pnpm check
pnpm test -- <相关测试文件>

# 日常完整验证
pnpm check
pnpm test
pnpm build
pnpm verify:build
```

- 本地开发机执行普通生产构建时，使用 512 MiB Node.js V8 堆上限并降低进程的
  CPU 调度优先级：

```bash
NODE_OPTIONS="--max-old-space-size=512" \
  nice -n 10 \
  pnpm build
```

```

- `--max-old-space-size=512` 限制 Node.js V8 堆内存，`nice -n 10` 只降低 CPU 调度优先级，
  并不限制总内存。若构建因堆内存不足失败，应保留日志并分析内存消耗，不得在脚本中静默
  提高上限或跳过构建步骤。
- 纯文档修改可不运行构建，但必须核对命令、路径和当前实现一致。
- 修改 TypeScript、TSX 或构建脚本后，对本次修改文件运行 `pnpm format -- <文件...>`，
  再运行 `pnpm check` 和对应测试。现有代码尚未一次性完成全量 Prettier 迁移，不得仅为
  格式统一批量改写无关文件。
- Renderer 源码或资源修改：至少运行相关测试和 `check`；交付前运行
  `build` 和 `verify:build`。
- Main、Preload、shared、Vite 或安全配置修改：运行全部日常完整验证。
- 依赖、打包、协议注册、更新或 `electron-builder.yml` 修改：除完整验证外，在目标操作系统
  运行相应 `pnpm pack:win`、`pnpm pack:mac` 或 `pnpm pack:linux`，再运行
  `pnpm verify:package -- --platform <win|mac|linux> --arch <x64|arm64|universal>`；
  `universal` 仅用于 macOS，且不能用跨平台生成成功替代目标平台真机验收。
- UI 变更除自动化测试外必须启动 `pnpm dev` 做人工视觉和交互检查。
- 不通过删除、跳过、放宽测试或关闭安全检查来让流水线变绿。

## 9. 跨端与发布变更

- 修改 API 路径、字段、状态码、错误码、分页、认证、Cookie、权限、实时协议、文件资源或
  外链规则时，必须分别核对 `server`、`client/web`、`client-desktop`、`client-mobile`。
- 在变更说明中记录各端“已修改 / 不受影响 / 尚未实现”，不能默认协议变更只影响 Desktop。
- 消息分区相关修改还必须核对 `server/internal/store/message_partitions.go` 和
  `server/docs/message-partitions.md`。
- 平台相关逻辑必须显式覆盖 Windows、macOS、Linux 差异；不得以当前开发机行为推断其他
  平台。只有目标系统和架构真机验收后，才能宣称该平台通过。
- Stable OTA 的 Release Notes、客户端界面和常规发布文档统一按正式版本书写，不展示或
  传递构建签名状态，也不得把签名状态加入 DesktopBridge、应用元数据或用户可见标签。
  后续接入或调整平台签名时，只修改构建与 CI 配置，不要求改动常规发布文案和客户端 UI。
- 发布链路必须持续校验 HTTPS、版本、平台、架构、清单、文件大小和 SHA-512。平台安装器
  因系统安全策略拒绝替换时，必须保留当前版本、返回稳定错误码并提供手动恢复入口；不得
  通过关闭系统安全检查、隐藏完整性错误或加入静默兼容分支绕过失败。
- 不提交证书、私钥、Token、真实账号、Server 地址、诊断包或包含用户数据的截图与日志。

## 10. 变更交付清单

1. 确认修改位于正确进程和目录，没有破坏 Renderer 独立边界。
2. 复核安全、隐私、资源生命周期、异常和跨平台边界。
3. 增加或更新与风险相匹配的测试和文档。
4. 执行本文件要求的验证命令，并记录未执行项目及原因。
5. 检查 `git diff`，确保没有生成物、敏感信息或无关改动。
6. 涉及协议或安全时，记录跨端影响；涉及 UI 时，记录人工验收窗口和主题。
```
