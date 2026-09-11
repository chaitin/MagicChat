# 发布、验证与恢复

## 发布定位

即应 Desktop 通过 `https://jiying.chat/releases/version.json` 发现新版本，再下载其中对应平台的完整安装包。客户端不再使用 GitHub Provider、`electron-updater`、`latest*.yml` 或外置 `.blockmap`。

GitHub 仓库 `ptonlix/MagicChat` 只承担构建、验证和公开 Release 分发。官网运维人员从 Actions 下载六文件手工上传目录，同步到 `https://jiying.chat/releases/`。普通客户端不会携带 GitHub Token。

`appId=com.magicchat.desktop`、`magicchat://` 协议和 `magicchat-desktop` 用户数据目录保持不变，因此安装即应不会主动清除登录状态、聊天记录或本地设置。

## 1.8.2 手工迁移边界

- 1.8.1 已使用 `version.json`，能够发现 1.8.2。
- 1.8.0 及更早版本不再提供旧 GitHub OTA 桥接，必须手工安装 1.8.2。
- macOS 品牌名称从 `MagicChat.app` 改为 `即应.app`，不在应用启动时执行一次性自动迁移。
- macOS 用户应退出 MagicChat，打开 `Jiying-<version>-mac-universal.dmg`，将即应拖入“应用程序”，再把 `/Applications/MagicChat.app` 移入废纸篓。
- 打开即应并确认登录状态和数据正常后再清空废纸篓。不要删除 `~/Library/Application Support/magicchat-desktop`。
- 完成 1.8.2 安装后，后续版本继续通过官网 `version.json` 更新。

## GitHub Release 资产

每个 Desktop Stable Release 必须恰好公开 8 个文件：

```text
Jiying-<version>-win-x64.exe
Jiying-<version>-win-arm64.exe
Jiying-<version>-mac-universal.dmg
Jiying-<version>-linux-x86_64.AppImage
Jiying-<version>-linux-amd64.deb
Jiying-<version>-linux-arm64.AppImage
Jiying-<version>-linux-arm64.deb
version.json
```

不得公开 macOS ZIP、`latest.yml`、`latest-mac.yml`、`latest-linux.yml`、`latest-linux-arm64.yml` 或任何外置 `.blockmap`。

## 官网手工上传目录

Actions artifact `jiying-website-release-<version>` 必须恰好包含：

```text
jiying.exe
jiying.dmg
jiying.amd.AppImage
jiying.arm.AppImage
version.json
SHA256SUMS.txt
```

运维必须上传这六个文件并保持文件名不变。官网 `version.json` 的 Desktop 条目只包含
`build`、`version` 和 `url`。`version.json` 应最后上传，避免客户端先看到新版本却下载到
旧安装包；上传后匿名访问每个 URL，并使用 `SHA256SUMS.txt` 复核文件摘要。

## Stable 发布流程

1. 准备非空 Markdown 发布说明并创建 Annotated Tag：

   ```bash
   git tag -a desktop-v1.8.2 --cleanup=verbatim -F release-notes.md
   git push origin desktop-v1.8.2
   ```

   无需再修改仓库中的 build。CI 会将四个 Desktop 平台的统一 build 设为上一正式版本 + 1；后续每个新的正式安装包集合继续递增，不能因 SemVer 变化而重置。

2. `quality` Job 执行静态检查、完整测试、生产构建、构建验证和工作流验证。
3. 五个原生目标生成并验证 7 个完整安装包。macOS 只生成签名、公证后的 Universal DMG。
4. `release` Job 生成 `version.json` 和精确的八文件发布计划，以 Draft 事务上传，复核名称、大小和 SHA-256 后公开。
5. 下载官网六文件 artifact，先上传四个固定文件名安装包和校验文件，最后上传 `version.json`。

Desktop `build` 由 CI 根据其他正式 `desktop-v*` Tag 计算：优先读取该 Tag 提交中遗留的 `release-version-base.json`，否则读取该 Tag 已公开 Release 的 `version.json`。当前 Tag 取 max+1，四个桌面平台使用同一个号。Android 和 iOS 从当前官网 `version.json` 原样带入。同一 Tag 的失败重跑得到同一个 build；只有新的正式 Tag 才递增。已经公开的版本和 Tag 不得覆盖，修复应同时发布更高版本号和更大 build。`version` 只用于展示和发布身份，客户端是否更新只比较 build。

## 失败恢复

- Draft 上传失败：仅在 Release ID、Tag、Draft 状态和当前 workflow run 所有权全部匹配时自动清理；禁止按 Tag 模糊删除。
- 已公开 Release 有问题：停止其成为 Latest，并发布更高补丁版本，不覆盖原 Tag 资产。
- 官网上传失败：保留旧 `version.json`，先补齐并校验安装包，最后再切换清单。
- Windows 安装器被策略阻止：使用匹配架构的完整 NSIS 手工安装，不绕过系统安全检查。
- macOS 自动替换受限：保留当前应用，使用 Universal DMG 手工安装。
- Linux AppImage 目录只读或权限失败：保留旧 AppImage，修复目录权限或手工替换；deb 继续通过包管理器升级。
- 新版本启动异常：保留用户数据和安全存储，优先发布更高补丁版本向前修复。

三平台真机结果记录在 [Stable OTA 验收指南](stable-ota-acceptance.md)。自动化构建通过不能替代安装、重启、数据保留与恢复路径的真机验收。
