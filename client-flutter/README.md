# MagicChat Flutter 客户端

这是 desktop/mobile 共用的 Flutter 客户端工程，已生成 Android、iOS、Windows、macOS、Linux 及 Web 宿主目录。
`lib/domain` 只放跨平台模型和仓储契约，`lib/data` 负责 HTTP/WebSocket，`lib/features` 负责页面，避免平台代码渗入 UI。

## 开发

```bash
flutter pub get
flutter run -d chrome       # 快速检查 UI
flutter run -d windows      # Windows
flutter run -d android      # Android 真机/模拟器
flutter analyze
flutter test
```

CI 可使用同样的命令验证：`flutter pub get && dart format --set-exit-if-changed lib test && flutter analyze && flutter test`。应用工程保留 `pubspec.lock` 以固定跨端依赖版本；`build/`、`.dart_tool/` 等生成目录不会提交。

仓库的 `client-flutter` GitHub Actions 会在相关目录变更时自动执行上述门禁，并构建 Web 与 Linux Debug 产物。

Linux 构建需要系统安装 `clang++`、GTK3、`libsecret-1-dev` 和 CMake；在 Ubuntu/Debian 上可执行 `apt install clang libgtk-3-dev libsecret-1-dev` 后运行 `flutter build linux`。

当前壳已覆盖原客户端的一级入口：消息、联系人、项目和设置，并提供登录/Server 配置入口。网络仓储契约对应 `/api/client/`，实时层对应既有 WebSocket envelope；迁移业务模块时只需替换 `MagicChatRepository` 实现，不改变页面导航。

WebSocket 连接器必须由平台适配层注入，并通过 `Authorization: Bearer <token>` 发送凭据；不会把 Token 放进 URL 查询参数。
