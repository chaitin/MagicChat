# MagicChat Mobile

MagicChat 的 Expo / React Native 手机客户端，包含：

- 多服务器管理与原生 Bearer 登录（1 小时访问凭据、90 天闲置过期的轮换刷新凭据；最长 365 天，安全存于 SecureStore）
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

## Android 性能诊断

埋点默认关闭，现有安装包不会自动获得埋点。配置好现有的 Android Release 签名环境变量后，重新构建诊断包：

```bash
EXPO_PUBLIC_MOBILE_PERF=1 ./android/gradlew -p android :app:assembleRelease
```

与已安装包签名不同的 APK 无法直接覆盖安装，切勿为了诊断卸载已有应用。前台运行时每 10 秒通过 Android `ReactNativeJS` 日志输出一条 `[mobile-perf]` 汇总，可用 `adb logcat -s ReactNativeJS:I '*:S'` 查看。`n` 为次数，`sum` 和 `max` 为毫秒数（`commit`、`prepare`、`conversation.local_read_reused` 仅使用 `n`）；`conversation.open_to_ready_ms` 从列表按下到聊天页数据可呈现，不等同于首帧绘制；`conversation.local_read_ms` 与 `conversation.sync_elapsed_ms` 分别包含异步本地读取和网络同步的等待时间；`conversations.sqlite_list_ms`、`conversations.sqlite_upsert_ms` 和 `conversations.sqlite_upsert_queue_ms` 分别统计会话列表 SQL 执行、批量写入执行及等待写队列的时间；`contacts.profiles_read_ms`、`contacts.profiles_merge_ms` 和 `contacts.profiles_merge_queue_ms` 对应用户资料的定向读取、合并写入和写队列等待；`js.lag_ms` 表示 100 毫秒定时器晚于预期至少 50 毫秒，不等同于 JS CPU 时间。只记录汇总，不记录账号、对话 ID 或消息内容。日志和诊断包仅用于本地性能分析，普通构建不设置该变量。

诊断包还会输出 `[mobile-startup]` 阶段日志，区分数据库打开/初始化、预览 SQL、本地预览加载、列表数据提交，以及本地历史预热和网络同步；`atMs` 是计时模块加载后的相对毫秒数，`count`/`loaded` 仅为数量。列表提交表示数据已进入 React 提交阶段，不等同于屏幕首帧。日志不会输出 SQL、账号、对话 ID、消息内容或原始异常；普通构建不启用这些日志。

仅用于性能对照时，可同时设置 `EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP=1`，跳过启动时逐对话预热 20 条历史消息；此开关必须与 `EXPO_PUBLIC_MOBILE_PERF=1` 一起使用，普通构建不受影响，网络同步和列表预览仍保持原逻辑。

`EXPO_PUBLIC_MOBILE_PROBE_PREVIEW_SQL=1` 与诊断模式一起使用时，会额外同步执行一次相同的只读预览 SQL，只记录耗时和行数；结果不会替换正常的异步读取，用于区分原生查询执行与 JS 回调等待。此探针会增加一次读取，仅用于定位问题，不用于正式性能验收。

`EXPO_PUBLIC_MOBILE_MINIMAL_CONVERSATION_ROWS=1` 与诊断模式一起使用时，将会话行临时替换为纯文本名称和真实消息预览；列表数据、数据库读取和网络同步不变，用于隔离头像、侧滑等复杂行组件的启动开销。该对照视图不提供完整交互，仅用于诊断。

2026-10-14 在 MEIZU_20_Pro 上用同签名 Release 诊断包完成 10 次启动采样，保留原有应用数据。除首次安装后的采样外，后续本地缓存包含 55 个会话，稳定返回 46 个预览，列表模型中 49 行有 40 行获得本地预览：

- 原完整行的预览端到端读取为 743–1112ms；跳过历史预热仍为 899–1001ms，预热不是主要原因。
- 同一只读预览 SQL 同步查询 55 行仅为 1–2ms，但原异步路径仍为 775–855ms，不能把端到端等待当成 SQL 执行时间。
- 只将会话行换成纯文本，保留 FlatList、真实预览、历史预热及网络逻辑后，预览读取降至 69–76ms，空预览到有预览的数据提交间隔降至 145–165ms；恢复完整行后读取再次为 768ms，提交间隔为 955ms。

对照将主要瓶颈定位到复杂会话行的首屏挂载及其异步调度开销，尚未单独区分头像和侧滑组件。提交间隔不是物理屏幕绘制时间。上述为修复前的定位过程。

随后实施首屏调度修复：首批非空会话集合的本地预览读取成功或失败后再挂载完整行；空集合预读不会提前放行，后续会话刷新不重新隐藏列表，切换账号及清缓存保留原隔离和竞态处理；离屏行按每批 4 行、5 屏窗口补齐。没有启用摘要兜底，没有替换头像或侧滑组件，普通构建也使用该修复。

同一手机又进行 3 次优化包冷启动和 1 次旧诊断包反向对照，均保留数据，诊断对照开关全部关闭：

- 优化包预览读取为 **54 / 50 / 60ms**；中间恢复旧诊断包重新测得 **746ms**。
- 从设备启动标记到首次带缓存预览的数据提交为 **1404 / 1400 / 1446ms**；旧诊断包为 **2229ms**。这不是整个应用启动仅需 50ms，也不是物理首帧测量。
- 同轮都读取 55 个会话、47 个本地预览，49 行列表模型中 41 行有缓存预览；优化包首次非空列表提交即带缓存预览，旧包先提交 49 行空预览，977ms 后补齐。
- 最后保留同签名 `2.5.0 / Build 29` 的完整功能优化诊断包，没有卸载或清除应用数据。

iOS 使用原生 APNs Token，固定连接 `https://push.jiying.chat`，并从签名 Entitlement 读取 sandbox/production 环境。Xcode Debug 使用 `development`，Release/TestFlight 使用 `production`；`with-apns-environments` config plugin 会在 prebuild 后保持这组配置。安装凭据、grant 和通知路由映射保存在 SecureStore；需要 Development Build 或 TestFlight 真机验证，Expo Go 不作为远程推送验证环境。

Android 使用本地 Expo Module 封装 JPush Android SDK 6.2.0，不依赖 Legacy React Native bridge，也不会注册 Expo/FCM Token。官方 JPush AppKey 已作为仓库内构建默认值固定；普通构建只需按需设置渠道名：

```bash
JPUSH_CHANNEL=development pnpm android
```

如需连接独立的开发或测试 JPush 应用，可用 `JPUSH_APP_KEY` 环境变量覆盖默认值。Master Secret 只能配置在 Gateway。应用会在登录后的冷启动和每次回到前台时检查推送状态：首次未同意 JPush 时主动提示，暂缓后同版本冷却 7 天，新版本可再次提示；系统通知权限或“消息通知”渠道关闭时引导进入系统设置。“设置 → 手机通知”使用 `XGUISwitch`，开启确认后以 loading toast 展示 RegistrationID/Gateway 同步过程，关闭则立即更新界面并将授权撤销持久化到后台队列。用户明确关闭后不再自动强弹。只有同意后，应用才会首次调用极光 API、关闭非必要的地理围栏、自启动、链路合并和活跃时长统计，并初始化 JPush、申请 Android 通知权限；关闭手机通知时会停止 JPush。RegistrationID、grant 和通知路由继续使用同一套 SecureStore 生命周期。Expo Go 不支持该原生模块，且不会被视为已配置。

华为、小米、OPPO、vivo 使用与 JPush SDK 相同的 `6.2.0` 官方厂商插件，仍由 JPush 统一发送。插件按构建环境条件打包，变量名见 `.env.example`：小米和 vivo 各需要 App ID/App Key，OPPO 需要 App ID/App Key/App Secret，华为需要下载的 `agconnect-services.json` 路径。任一通道只配置部分参数时构建会直接失败；没有配置的通道不会进入 APK。厂商服务端凭据仍只配置在极光控制台，不进入移动端或仓库。

华为、小米、OPPO、vivo 通道都必须使用对应签名和真实设备执行杀进程 POC；小米、OPPO、vivo 的正式推送通常还要求应用已在对应应用市场上架。
