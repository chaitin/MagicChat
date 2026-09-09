# JPush Android 真机 POC

## 配置边界

Android Development Build 默认使用仓库内固定的官方 JPush AppKey：

```bash
JPUSH_CHANNEL=development pnpm android
```

仅在连接独立开发/测试 JPush 应用时，才通过 `JPUSH_APP_KEY` 环境变量覆盖默认值。厂商插件按环境变量条件打包；变量定义见 `client-mobile/.env.example`。小米、vivo、OPPO 必须一次提供该通道的全部变量，华为通过 `JPUSH_HUAWEI_AGCONNECT_SERVICES` 指向从 AppGallery Connect 下载的 JSON 文件。未配置的厂商插件不会进入 APK。

公共 Push Gateway 才能持有 Master Secret：

```dotenv
PUSH_PROVIDERS=apns,jpush
JPUSH_APP_KEY=your-app-key
JPUSH_MASTER_SECRET=your-master-secret
```

Master Secret、RegistrationID、厂商 token、management token、send token 和 route token 均不得写入日志或提交仓库。移动端不得把 Expo/FCM token 注册为 JPush token；华为、小米、OPPO、vivo token 仅由对应官方插件交给 JPush，MagicChat Gateway/private Server 仍只接触 JPush RegistrationID。

## 启用流程

1. 安装 Development Build 并登录测试账号。
2. 打开“设置 → 手机通知”。
3. 阅读极光数据处理说明，选择“同意并启用”。
4. 同意 Android 13+ 通知权限。
5. 设置页状态最终应从“正在同步”变为“已启用”。
6. 关闭后应撤销 Gateway/private Server grant，并调用 JPush `stopPush`；再次启用必须调用 `resumePush` 并重新取得 RegistrationID。

在用户明确同意前，应用不得调用任何 JPush SDK API。

## 必测场景

- App 前台：不展示远程通知。
- App 后台：只展示一条固定文案通知。
- App 被系统杀死：通知可达，点击后冷启动并定位目标消息。
- 同一通知响应重复回调：只导航一次。
- 同一会话连续通知：新通知清理该会话先前的通知栏条目。
- Gateway 在不确定响应后重试：复用同一个持久化 JPush CID，不产生第二次推送。
- 无网络后恢复：RegistrationID 和 grant 自动重试。
- 退出当前账号：Server session 与 private grant 原子删除，Gateway grant 后续撤销。
- 切换账号：旧账号 route 不得在新账号打开。
- 重装 App：旧 RegistrationID 最终被 Gateway 标记失效，新安装可重新授权。
- 关闭系统通知权限：设置页显示“通知权限未开启”。
- Gateway 未启用 JPush：设置页显示 Provider 不可用，不无限重试；Expo Go 等不含原生模块的包仍显示“安装包未配置”。

## 厂商覆盖

客户端已支持 JPush 6.2.0 对应的华为、小米、OPPO、vivo 官方插件，Gateway 无需增加厂商 Provider。每个厂商仍需在自己的开发者后台和极光控制台配置应用、包名、签名及服务端凭据；仅把插件打进 APK 不能证明 App 被杀死后的厂商通道可达。

每台设备至少记录以下不含敏感值的结果：设备品牌/系统版本、实际厂商通道、前台/后台/被杀状态、到达耗时、点击冷启动结果、token 轮换结果和失败错误类别。
