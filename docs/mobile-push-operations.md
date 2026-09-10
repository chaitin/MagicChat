# 手机推送运行监控

私有 Server 在 `/metrics` 暴露 Prometheus 文本指标；公共 Push Gateway 在 `https://push.jiying.chat/api/metrics` 暴露匿名聚合指标。两个端点都不包含用户、私有服务器地址、会话、消息、设备 token、grant capability 或 route token。

## 私有 Server 接入

每台私有 Server 只需配置 Push Gateway 管理页面签发的独立密钥：

```dotenv
PUSH_GATEWAY_SERVER_KEY=<32 位小写 Hex Server Key>
```

密钥为空时推送关闭，配置有效密钥后推送启用。Server 首次启用时会自动生成内部凭据加密密钥，写入 Compose 的 `server-push-data` 持久卷；该内部密钥不发送给 Gateway，也不需要部署者配置。备份和恢复私有 Server 时必须同时保留这个卷，否则数据库中的既有 Grant 无法解密，移动客户端需要重新注册。

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

## Session 绑定迁移

迁移 37 会删除无法安全映射到具体登录 Session 的旧私有 Grant，再增加 `session_id` 外键。新版移动端会检测私有注册版本并在首次同步时立即重新注册；迁移过程中不会删除公共 Gateway 安装，通知能力会在客户端重新注册后恢复。

Server 与移动端应作为兼容发布窗口一起升级：新版路由解析使用 POST body，旧版把 route token 放在 URL。仓库内置 Caddy 会跳过旧路径的访问日志；使用自定义反向代理的部署也必须在升级窗口内禁止记录 `/api/client/push/routes/*` 旧路径，待旧客户端退出后再移除该兼容日志规则。
