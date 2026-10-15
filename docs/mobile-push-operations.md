# 手机推送运行监控

私有 Server 在 `/metrics` 暴露 Prometheus 文本指标；公共 Push Gateway 在 `https://push.jiying.chat/api/metrics` 暴露匿名聚合指标。两个端点都不包含用户、私有服务器地址、会话、消息、设备 token、grant capability 或 route token。

## 私有 Server 接入

每台私有 Server 只需配置 Push Gateway 管理页面签发的独立密钥：

```dotenv
PUSH_GATEWAY_SERVER_KEY=<32 位小写 Hex Server Key>
```

密钥为空时推送关闭，配置有效密钥后推送启用。Server 首次启用时会自动生成内部凭据加密密钥，写入宿主机 `./data/server/push/credential.key`；该内部密钥不发送给 Gateway，也不需要部署者配置。备份和恢复私有 Server 时必须保留整个 `data` 目录，否则数据库中的既有 Grant 无法解密，移动客户端需要重新注册。

Server Key 只用于向 Gateway 证明服务器身份。管理页面重置 Server Key 不会改变内部加密密钥，因此不会破坏历史凭据；更新 `.env` 中的 Server Key 并重建 Server 即可。

## 指标

私有 Server：

- `magicchat_mobile_push_enabled`
- `magicchat_mobile_push_events{status}`
- `magicchat_mobile_push_jobs{status}`
- `magicchat_mobile_push_grants{status}`
- `magicchat_mobile_push_recent_failed_events`
- `magicchat_mobile_push_recent_failed_events_by_code{code}`
- `magicchat_mobile_push_recent_failed_jobs`
- `magicchat_mobile_push_recent_failed_jobs_by_code{code}`
- `magicchat_mobile_push_oldest_pending_event_age_seconds`
- `magicchat_mobile_push_oldest_pending_job_age_seconds`

公共 Push Gateway：

- `push_gateway_jobs{status}`
- `push_gateway_grants{status}`
- `push_gateway_installations{provider,platform,status}`
- `push_gateway_recent_failed_jobs`
- `push_gateway_recent_failed_jobs_by_code{code}`
- `push_gateway_oldest_pending_job_age_seconds`

## 启用内置 Prometheus

仓库提供可选的 Compose `monitoring` profile。它会抓取 Compose 内的私有 Server 和固定生产 Gateway，并加载 `deploy/monitoring/push-alerts.yml`：

```bash
docker compose --profile monitoring up -d prometheus
```

Prometheus 默认只监听宿主机 `127.0.0.1:19090`，可通过 `PROMETHEUS_PORT` 修改端口。数据保留 30 天并写入 `prometheus-data` volume。规则覆盖指标不可用、event fanout 积压、私有投递积压、Gateway 投递积压，以及最近十分钟内持续出现的非预期终态失败。设备 token 自然失效和已撤销 Grant 等正常生命周期错误仍计入总数，但不会触发失败告警。

内置 profile 不预设 Alertmanager 接收人，因为 webhook、邮件、企业微信或钉钉地址属于部署密钥。生产环境应在 `deploy/monitoring/prometheus.yml` 中增加部署方的 `alerting.alertmanagers`，并由独立 Secret 管理接收端配置，不应将接收地址或凭据提交到仓库。

## 排查

先区分 event 和 job：

- event 积压通常表示数据库、fanout 策略查询或私有 Server Worker 异常；
- 私有 job 积压通常表示 Gateway 网络、Gateway 限流或私有 Worker 异常；
- Gateway job 积压通常表示 APNs 或 JPush 超时、限流或凭据异常；
- `recent_failed_*` 大于零但没有积压，通常表示凭据、固定 payload、设备标识或权限配置被 Provider 立即拒绝。

`retry` 数量和最老待处理年龄同时持续上升时，应一起检查私有 Server 与公共 Push Gateway 日志。失败指标持续告警时，应先按匿名错误类别定位配置问题，禁止在排查日志中输出 provider token、grant capability 或 route token。

## 通知策略与设备活跃状态

- 消息仍逐条创建独立任务，不新增短时间消息聚合。每条私有推送任务入队后等待 5 秒，发送前重新检查消息是否已读、免打扰、成员权限与设备状态。
- 免打扰仍不推送，被 @ 也不例外。已读进度使用会话自己的游标；话题使用话题参与者游标，不以父会话的已读状态代替。
- 手机仅在前台、实时连接就绪且本地消息初始化完成后上报活跃；只抑制绑定该登录 Session 的手机，不影响同账号其他手机。
- 电脑联动策略默认关闭，不提供客户端设置入口。Desktop 必须主窗口聚焦、实时连接就绪、系统最近 120 秒有交互，且未锁屏/休眠，才算活跃；仅有 WebSocket 连接不算。
- 活跃设备每 15 秒续约一次，前后台或锁屏/休眠切换立即上报。租约 45 秒后自动失效；后台状态不重复发送心跳。状态上报按客户端串行处理，避免较慢的前台请求覆盖其后的后台请求。
- 迁移 45 新增账号通知偏好与 Session 活跃租约表，不删除已有推送授权。先升级 Server 和 Push Gateway，再发布新版 Desktop/Mobile；未升级客户端继续走既有推送，不会被误判前台。

## 内部推送诊断

诊断数据保留用于内部排障，不提供客户端设置入口。客户端在内存中记录系统权限、系统 Token、网关注册/授权和私有服务器绑定阶段；受鉴权接口可查询本机前台租约、电脑活跃状态、私有任务跳过原因及网关最近任务。

- 私有任务 `suppressed` 可记录 `already_read`、`mobile_foreground`、`desktop_active`；既有权限或免打扰变化仍记录 `policy_changed`。
- 私有任务 `sent` 只代表网关已接收；网关 `accepted` 只代表 APNs/JPush 已受理，均不是手机实际展示或送达回执。
- 获取原生设备 Token 最多等待 15 秒，超时显示 `push_device_token_timeout` 并由现有同步重试机制恢复，不永久停留在「开启中」。
- `/api/client/push/preferences`、`/api/client/push/presence`、`/api/client/push/status` 均要求当前账号登录；设备与用户身份由服务端认证上下文确定，客户端不能代报其他 Session。
- Gateway `GET /api/v1/grants/{grant_id}/status` 必须使用对应安装的 `Installation` 管理凭据，发送用的 Bearer capability 无权读取。响应仅包含通道、环境、状态、匿名错误类别和时间，不返回 Token、消息正文或路由。

公开聚合 `/metrics` 仅用于监控，不参与上述策略或送达确认；生产环境仍建议通过反向代理限制指标采集来源。

## Session 绑定迁移

迁移 37 会删除无法安全映射到具体登录 Session 的旧私有 Grant，再增加 `session_id` 外键。新版移动端会检测私有注册版本并在首次同步时立即重新注册；迁移过程中不会删除公共 Gateway 安装，通知能力会在客户端重新注册后恢复。

Server 与移动端应作为兼容发布窗口一起升级：新版路由解析使用 POST body，旧版把 route token 放在 URL。仓库内置 Caddy 会跳过旧路径的访问日志；使用自定义反向代理的部署也必须在升级窗口内禁止记录 `/api/client/push/routes/*` 旧路径，待旧客户端退出后再移除该兼容日志规则。
