# Mobile 多账号发布安全与隔离基线

本文件是任务 1 的发布约束，不实现 Mobile Session 能力响应或 Bearer 认证。

- 认证业务缓存的唯一 scope 是 `createServerKey(target) + userId`；其中 URL 经 `normalizeServerUrl` 规范化。Query、Manager 内存键和 SQLite 主键/读写条件必须使用同一身份，禁止仅用 serverId 或实体 ID。
- `AuthenticatedTarget` 只允许 `id`、`url`、`userId`。token/Authorization 不得进入 target、业务模型、Query key、SQLite、AsyncStorage、deep link、Push payload、本地通知、错误或日志。
- 日志或错误边界使用 `redactSensitiveValue`；来自非 TypeScript 边界的 target 使用 `assertSafeAuthenticatedTarget`。真正的 Session token 后续只能在 SecureStore 与传输内存中出现。
- 生产认证 HTTP 与 WebSocket 仅允许 HTTPS/WSS。唯一例外是调用者明确启用开发模式且 host 为 `localhost`、`127.0.0.1` 或 `[::1]` 的 HTTP/WS；不能用环境隐式放宽任意主机。
- Mobile 能力响应默认按 native/no-Origin 请求处理。服务端后续实现能力响应时不得使用 `Access-Control-Allow-Origin: *`；浏览器 Origin 默认拒绝，仅允许显式配置且精确匹配的可信 Origin，并只暴露必需 Header。普通 Web 登录响应不得含 token。
- 保留现有不透明随机 Session、服务端 hash 存储及有效期语义；本基线不得引入 JWT 或实现能力响应。

`tests/multi-account-boundary.test.ts` 是发布门禁：验证同服异用户/异服 scope、SQLite schema 和 SQL 条件，并扫描上述持久化与分发边界的敏感字段。
