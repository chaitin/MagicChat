# 即应 Desktop

`client-desktop` 是 MagicChat 的 Electron 桌面客户端，使用一套代码支持 Windows、
macOS 和 Linux，并通过公开 Stable Release 提供跨版本更新。

Desktop Renderer 已从 `client/web` 独立出来，拥有自己的页面、组件、数据层、样式、
资源和测试。它不直接引用 Web 源码，也不会自动同步 Web 的界面修改。

## 环境要求

- Node.js 24
- pnpm 11.1.3
- 对应目标平台的本机构建环境

```bash
cd client-desktop
pnpm install --frozen-lockfile
pnpm dev
```

Renderer 调试地址固定为 `http://localhost:20050`。端口被占用时启动会直接失败，
不会静默切换端口。

首次启动时需要在界面中手动填写 MagicChat Server 地址。当前桌面端只使用一个
用户指定的 Server，不提供多服务器管理或切换入口。开发构建允许连接 localhost
HTTP 服务；打包应用只接受 HTTPS 服务。

## 常用命令

```bash
# 代码标准检查、测试和生产构建
pnpm check
pnpm test
pnpm build

# 检查 Renderer 独立边界和构建结果
pnpm verify:boundaries
pnpm verify:build

# 在对应操作系统上生成 Stable 测试包
pnpm pack:win
pnpm pack:mac
pnpm pack:linux
```

打包产物位于 `dist/`：

- Windows：NSIS，x64/arm64
- macOS：DMG 和 ZIP，Universal（包含 x64/arm64）
- Linux：AppImage 和 deb，x64/arm64

应用内更新和手工恢复使用完整安装包：Windows NSIS、macOS Universal DMG 和 Linux AppImage；
发布流程不再生成旧版 `latest*.yml`、外置 `.blockmap` 或 macOS ZIP。
macOS DMG 只用于首次安装和失败恢复，Linux deb 只提供匹配架构的手动升级。

macOS 本地打包后可直接启动对应架构的应用，例如：

```bash
open dist/mac-universal/即应.app
```

跨平台安装、验收和发布要求见
[发布、验证与恢复](docs/release-recovery.md)。
跨版本真机矩阵、执行步骤和记录模板见
[Stable OTA 验收指南](docs/stable-ota-acceptance.md)。

## 目录结构

```text
client-desktop/
├── src/
│   ├── main/       Electron Main：窗口、会话、网络、文件和系统能力
│   ├── preload/    版本化 DesktopBridge 的安全暴露层
│   ├── renderer/   独立 React 应用及其测试、样式和资源
│   └── shared/     Main、Preload、Renderer 共用的 Bridge 类型
├── public/         Desktop 自有静态资源
├── scripts/        构建、边界和产物验证脚本
├── docs/           架构安全及发布运维文档
└── electron-builder.yml
```

架构边界、安全模型、认证现状和跨端变更规则见
[架构与安全模型](docs/architecture-security.md)。
