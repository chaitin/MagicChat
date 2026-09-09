# MagicChat Mobile

MagicChat 的 Expo / React Native 手机客户端，包含：

- 多服务器管理与 Cookie 会话登录
- 左侧抽屉导航
- 共享页面 Header
- 消息、通讯录、项目三个底部 Tab
- 会话列表、联系人目录、项目列表和文本消息收发
- WebSocket 实时消息、断线增量同步和后台通知
- iOS 原生 APNs Token、Android JPush RegistrationID、公共 Push Gateway grant 与私有 Server 通知路由
- 官方服务器与自定义 HTTP/HTTPS 服务器
- Tamagui 2 默认组件与明暗主题

## 本地开发

```bash
pnpm install
pnpm start
```

也可以直接启动指定平台：

```bash
pnpm android
pnpm ios
pnpm web
```

## 检查

```bash
pnpm typecheck
pnpm lint
```

iOS 使用原生 APNs Token，固定连接 `https://push.jiying.chat`，并从签名 Entitlement 读取 sandbox/production 环境。Xcode Debug 使用 `development`，Release/TestFlight 使用 `production`；`with-apns-environments` config plugin 会在 prebuild 后保持这组配置。安装凭据、grant 和通知路由映射保存在 SecureStore；需要 Development Build 或 TestFlight 真机验证，Expo Go 不作为远程推送验证环境。

Android 使用本地 Expo Module 封装 JPush Android SDK 6.2.0，不依赖 Legacy React Native bridge，也不会注册 Expo/FCM Token。官方 JPush AppKey 已作为仓库内构建默认值固定；普通构建只需按需设置渠道名：

```bash
JPUSH_CHANNEL=development pnpm android
```

如需连接独立的开发或测试 JPush 应用，可用 `JPUSH_APP_KEY` 环境变量覆盖默认值。Master Secret 只能配置在 Gateway。应用会在登录后的冷启动和每次回到前台时检查推送状态：首次未同意 JPush 时主动提示，暂缓后同版本冷却 7 天，新版本可再次提示；系统通知权限或“消息通知”渠道关闭时引导进入系统设置。用户在“设置 → 手机通知”明确关闭后不再自动强弹。只有同意后，应用才会首次调用极光 API、关闭非必要的地理围栏、自启动、链路合并和活跃时长统计，并初始化 JPush、申请 Android 通知权限；关闭手机通知时会停止 JPush。RegistrationID、grant 和通知路由继续使用同一套 SecureStore 生命周期。Expo Go 不支持该原生模块，且不会被视为已配置。

华为、小米、OPPO、vivo 使用与 JPush SDK 相同的 `6.2.0` 官方厂商插件，仍由 JPush 统一发送。插件按构建环境条件打包，变量名见 `.env.example`：小米和 vivo 各需要 App ID/App Key，OPPO 需要 App ID/App Key/App Secret，华为需要下载的 `agconnect-services.json` 路径。任一通道只配置部分参数时构建会直接失败；没有配置的通道不会进入 APK。厂商服务端凭据仍只配置在极光控制台，不进入移动端或仓库。

华为、小米、OPPO、vivo 通道都必须使用对应签名和真实设备执行杀进程 POC；小米、OPPO、vivo 的正式推送通常还要求应用已在对应应用市场上架。
