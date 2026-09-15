# 即应 · 新桌面客户端

全新的 **Electron 桌面客户端原型**，位于 `client/desktop/`，独立于旧版 `client-desktop` 和移动客户端。

## 启动

环境：Node.js 24+、pnpm 11+。Linux 桌面运行需要图形会话和 Electron 所需的系统库。

```bash
cd client/desktop
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会先调用 Electron 官方 `install-electron` 检查运行时：已安装时直接启动，缺失时下载与依赖版本匹配的二进制。Electron 43 的 npm 包没有自动安装运行时的 postinstall；仅完成 `pnpm install` 并不代表桌面二进制已就绪。

如果默认 GitHub 下载源无法访问，可在当前命令临时使用镜像补装（保留 npm 包内的校验和验证，不改全局 npm 源）：

```bash
# Linux / macOS / WSL
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm setup:electron
pnpm dev
```

也可执行 `pnpm setup:electron` 单独准备运行时。不要通过删除锁文件、伪造 `path.txt` 或关闭沙箱来处理 `Electron uninstall`。

只想先看样式，也可以启动浏览器预览：

```bash
pnpm dev:web
```

打开终端输出的 `http://127.0.0.1:20110`。桌面开发与浏览器预览使用同一个固定端口，不要同时运行；浏览器模式没有 Electron 的系统原生标题栏。

## 当前内容

- 应用每次启动先显示服务器选择页，不自动连接上次服务器；选择并连接成功后进入官方 shadcn `login-03` 登录页。
- 邮箱验证码（8 位）/密码登录，根据服务端能力显示可用方式；默认优先验证码，登录方式使用官方 shadcn Tabs。
- 登录页左上方提供“切换服务器”按钮，可退回服务器选择页；两个入口页底部显示“当前系统由即应 Chat驱动”，官网链接通过受限 IPC 在系统浏览器打开；服务端控制验证码重发倒计时，支持 Retry-After、连接失败重试和 Enter 提交。
- Electron Session Cookie 管理、重启恢复登录、退出登录与跨服务器隔离。
- 登录成功后展示真实账号和工作空间信息；聊天工作空间尚未实现。
- 基于官方 shadcn `sidebar-13` block 的设置对话框集中提供浅色/深色主题、服务器配置与关于信息；服务器页支持新增、查看、编辑、删除和可用性检测；全界面统一使用 Hugeicons 免费图标集。
- 减少动态效果支持、键盘焦点、小窗口滚动。
- 全界面统一使用官方 HarmonyOS Sans SC（中英文、按钮、输入框、弹窗及版本号）；Regular/Medium/Bold 原始 TTF 随应用内置，不裁剪、不转换，不依赖系统字体或外部字体 CDN。
- 鸿蒙字体许可要求禁止修改字体、保留许可并显示使用标注；设置对话框的“关于”页面显示标注与版本号，登录页不显示底部状态栏，原始许可随构建复制到 `licenses/harmonyos-sans.txt`。来源和哈希见 `THIRD_PARTY_NOTICES.md`。
- 默认窗口 1280 × 900，最小窗口 760 × 560（逻辑像素）；使用操作系统原生标题栏及最小化/最大化/关闭按钮，不在 Renderer 自绘窗口框架。原生标题使用“即应”。它由操作系统字体绘制，应用内置的 HarmonyOS Sans SC 只作用于页面内容；缺少中文系统字体的 Linux/WSL 环境可能显示方框，Windows 中文字体环境不受影响。

**尚未实现聊天、消息数据库、多账号列表、第三方登录或自动更新。** Electron 使用独立的 `jiying-desktop-next` 用户数据目录，不读取旧客户端数据。

## 认证与数据边界

- 登录交互和 API 字段参考 `client-mobile`；不发送移动端会话能力头，不复制移动端 Token 或密码保存逻辑；登录页不额外显示协议确认行。
- Renderer 通过限定能力的 Preload Bridge 调用 Main，不全局替换 `fetch`，不直接访问服务器或 Cookie。
- 每个规范化服务器地址（含端口和部署路径）使用独立的持久 Session。登录后必须通过 `/api/client/me` 确认 Cookie 会话，才显示成功。
- `login-preferences.json` 使用 v2 格式保存服务器名称/地址列表、当前服务器、HTTP 风险确认和每台服务器最近的邮箱，不保存密码或验证码；旧版 v1 单服务器配置会自动迁移。
- 密码、验证码不会写入日志或配置文件；Cookie 由 Electron 管理。生产版本不允许通过测试环境变量更换数据目录。
- 默认 HTTPS；HTTP 必须显式确认明文传输风险。不跳过证书验证，不自动跟随 API 重定向。
- 退出时清理本地 Cookie；若远端撤销未确认，会明确提示，不把离线清理冒充完整远端退出。
- 浏览器模式仅显示登录样式，禁用真实登录、发送验证码与服务器切换，不会模拟认证成功。

使用接口：`GET /api/client/info`、`GET /api/client/me`、`POST /api/client/auth/login`、`POST /api/client/auth/email-code/request`、`POST /api/client/auth/email-code/login`、`POST /api/client/auth/logout`。

## 技术栈

Electron + React + TypeScript + electron-vite + Tailwind CSS。

登录界面按官方 `login-03` block 源码适配（对应命令 `npx shadcn@latest add login-03`），复用已由 CLI 安装的官方基础组件。保留原版 CardHeader、CardContent、FieldGroup 和单栏间距；将顶部第三方登录按钮替换为真实支持的验证码/密码登录入口，不显示未接入的注册按钮、页面品牌标题或侧边占位图。

`components/login-form.tsx` 保存登录 block 结构，`components/settings-dialog.tsx` 保存 `sidebar-13` 设置结构，`features/auth/login-form.tsx` 只负责认证状态 hook。不通过大段自定义 CSS 覆盖组件字号、圆角或间距；只有 Electron 窗口结构和本地中文字体做必要适配。beUI 只增强登录按钮的状态文字。来源、修改说明和 MIT 许可见 `THIRD_PARTY_NOTICES.md`。

Vite / React 插件版本以 electron-vite 的 peerDependencies 为准，锁文件固定依赖。

```text
src/main/          桌面启动、窗口、IPC 校验和认证控制器
src/preload/       仅暴露限定的认证操作
src/shared/        Bridge 契约、认证类型和输入校验
src/renderer/      独立 React 页面、组件和主题
src/renderer/components/login-form.tsx  官方 login-03 block 与业务字段
src/renderer/components/settings-dialog.tsx  官方 sidebar-13 block 适配的设置对话框
src/renderer/components/server-settings.tsx  服务器配置 CRUD 与可用性状态
src/renderer/features/auth/  认证状态 hook、服务器选择页、连接状态
```

## 验证

```bash
pnpm typecheck
pnpm format:check
pnpm build

# 在 Windows 或 WSL/Linux 生成未签名的 Windows x64 NSIS 预览安装包
# 默认 GitHub 下载源不可用时可临时使用与 Electron 相同的镜像策略
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  pnpm pack:win

# 准备 Electron 运行时并启动开发程序
pnpm setup:electron
pnpm dev
```

Windows 预览安装包输出到被 Git 忽略的 `dist/Jiying-Desktop-Preview-*-win-x64.exe`。它未做代码签名，仅用于本机体验，不能作为正式发布包。
