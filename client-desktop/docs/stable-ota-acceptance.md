# Stable OTA 验收指南

## 当前记录

基于 `version.json` 的全量 OTA 已进入代码和流水线验证阶段，下列平台组合仍需用两个连续
Stable 版本完成真机验收。在真实升级证据完成前均保持“待真机验收”。

## 验收矩阵

- Windows 10 22H2 x64：待验收，记录系统安装提示、NSIS 替换和用户数据保留。
- Windows 11 24H2 x64：待验收。
- Windows 11 24H2 arm64：仅手动升级；验证不会误下 x64 安装包。
- macOS 13 Intel：待验收。
- macOS 13 Apple Silicon：待验收。
- macOS 14 Intel：待验收。
- macOS 14 Apple Silicon：待验收。
- macOS 15 Intel：待验收。
- macOS 15 Apple Silicon：待验收。
- Ubuntu 22.04/24.04 AppImage x64：待验收。
- Ubuntu 22.04/24.04 AppImage arm64：待验收。
- Debian 12/13 deb x64/arm64：待验收，仅验证手动升级，不验证自替换。

macOS Universal 产物包含 Intel 和 Apple Silicon 代码，但一个架构或系统版本通过不能推断
其他组合通过。便携解压、只读安装目录、Linux deb 和被平台安全策略拒绝的 macOS 安装来源
不属于 OTA 成功路径，必须验证手动恢复。

## 候选准备

1. 发布较低版本 `desktop-vN-1`，安装并完成一次正常登录，记录不敏感的测试配置标识。
2. 发布更高补丁版本 `desktop-vN`，确认 Release 是公开、非草稿、非 prerelease，恰好包含
   8 个约定资产，且不包含 `latest*.yml`、macOS ZIP 或外置 `.blockmap`。
3. 核对 `N-1` 与 `N` 的应用版本和递增 build、`version.json` 平台映射、安装包架构和摘要；
   四个 Desktop 清单条目必须使用候选包内的同一个 build。
4. 匿名访问官网 `version.json` 和各平台 URL；请求不得携带 Token、Authorization Header
   或私有下载 URL，并确认客户端下载过程没有 `.blockmap` 请求。
5. 验收前备份用户数据目录并记录恢复方式，但记录中不得包含账号、Server 地址、Token、
   Cookie、消息正文或本地绝对路径。
6. 对 1.8.0 及更早版本执行一次手工安装 1.8.2；macOS 只移除
   `/Applications/MagicChat.app`，不得删除 `~/Library/Application Support/magicchat-desktop`。

## 通用 OTA 步骤

1. 从原生安装来源安装 `N-1`，启动并确认版本、build、平台、架构和 Stable 通道。
2. 保留一项可识别但不敏感的用户配置，完成登录和基础聊天健康检查。
3. 等待启动后 60 秒自动检查，或在设置中手动检查；确认只出现一个检查请求。
4. 核对目标版本和安装模式，不得在界面暴露 Header、Token 或缓存路径。
5. 开始下载，确认进度处于 0 至 100 且不回退；重复点击不得创建并行下载。
6. 下载完成后选择“稍后”，确认当前版本继续工作；再次进入设置后选择“立即重启安装”。
7. 有活跃文件传输时确认安装被阻止；完成或明确取消传输后重试。
8. 重启后核对版本 `N`、目标 build、启动健康标记、Server 配置、安全存储、会话和用户数据保留。
9. 模拟离线、超时、限流、下载中断、磁盘不足、摘要错误、权限失败和只读路径，确认失败
   后当前版本仍可运行，并提供重试或手动升级。
10. 额外验证 build-only 规则：远端 version 更高但 build 相同或更低时不得提示更新；远端
    version 相同或更低但 build 更大时必须发现更新。

## 平台重点

- Windows：x64 从 `version.json.windows` 下载完整 NSIS；ARM64 必须保持手动模式且不得下载
  x64 安装包。记录系统安装提示和替换/重启结果。
- macOS：验证从 `version.json.macos` 下载 Universal DMG、打开镜像并完成覆盖安装；若系统
  安全策略拒绝，记录 `platform_signature_required` 并确认原应用仍可运行。品牌迁移时手工安装
  `即应.app`，确认数据正常后再将旧 `MagicChat.app` 移入废纸篓。
- Linux AppImage：确认 `APPIMAGE` 来源、可执行权限和所在目录可写；x64/arm64 分别读取
  `linux-amd`/`linux-arm`。只读目录必须失败并保留旧版本。
- Linux deb：不得调用自替换，只显示匹配架构的手动下载；使用系统包管理器升级后核对数据。

## 记录模板

```text
执行日期：
执行人：
操作系统及版本：
CPU 架构：
安装来源：NSIS / macOS App / AppImage / deb / 其他
基线 Tag、应用版本与 build：
候选 Tag、应用版本与 build：
自动检查：通过 / 失败 / 未执行
手动检查：通过 / 失败 / 未执行
下载与进度：通过 / 失败 / 未执行
活跃传输阻塞：通过 / 失败 / 未执行
替换并重启：通过 / 失败 / 未执行
启动健康标记：通过 / 失败 / 未执行
用户数据保留：通过 / 失败 / 未执行
平台安全提示或错误码：
手动恢复载体与结果：
已知限制：
脱敏证据位置：
最终结论：通过 / 仅手动升级 / 不支持 / 待复测
```

发布负责人必须逐项回填。没有实际证据的字段保持“未执行”，不能依据自动化构建或其他
平台结果推断成功。
