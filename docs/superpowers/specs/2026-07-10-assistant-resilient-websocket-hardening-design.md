# Assistant Resilient WebSocket Hardening Design

## 背景

初版 resilient WebSocket 实现已经完成连接与 agent session 解耦、稳定 request ID 重试、服务端请求去重以及 app event cursor 重放。最终审查确认仍有五个需要在合并前修正的边界：同会话 message seq 与 outbox cursor 可能逆序、全局 watermark 淘汰后活跃 job 可能重复追加、长时间断线重放会无界占用内存、401/403 会被外层连接循环继续重试，以及 server `WriteJSON` 的换行符会突破精确 1 MiB 边界。

本设计是原设计 `2026-07-10-assistant-resilient-websocket-design.md` 的收敛补充；未被本设计覆盖的原有语义保持不变。

## 目标

- 同一 conversation 的 app trigger 必须按 message seq 对应的顺序进入 outbox 和 Session Manager。
- message 与 app event outbox 在同一数据库事务中提交。
- server 和 assistant 的事件重放内存都有明确上限。
- assistant 事件队列满时不得丢 cursor，也不得阻塞 response reader。
- server replay backlog 不得丢弃或饿死 app request response。
- 活跃 session 即使已从全局 watermark 缓存淘汰，也不会重复追加旧 seq。
- 401/403 等永久认证错误停止后台重连并返回调用方。
- server 实际发送的 WebSocket message 严格不超过 1 MiB。

## 非目标

- 不增加 agent session 落盘。
- 不增加旧 app 的 capability negotiation。
- 不为 request cache 增加 running-entry 准入限制；原设计明确允许 running entry 不参与 completed LRU 淘汰。
- 不改变超大 event 当前的记录并跳过语义；现有唯一 cursor event `message.created` 受业务字段长度约束，无法达到 1 MiB。
- 不增加通用 panic recovery。

## 事务内 Outbox

### 问题

当前 message seq 在 conversation 行锁事务内分配，但 outbox 在事务返回后写入。两个并发请求可以按 seq 提交，却按相反顺序写入 outbox。assistant 按 cursor 先处理较大 seq 后，会把随后到达的较小 seq 误判为重复。

### 设计

所有用户消息创建路径继续通过 `createUserMessageWithMetadata`。该函数在持有 conversation `FOR UPDATE` 行锁的事务内完成：

1. 分配并写入 message seq。
2. 更新 conversation 和 mention 元数据。
3. 计算需要接收事件的 app ID。
4. 为每个目标 app 构造 `message.created` payload 并写入 `app_event_outbox`。
5. 提交事务。
6. 事务成功后，按已创建的 outbox row ID 向当前 live connection 投递。

同一 conversation 的下一条消息必须等待前一事务释放行锁，因此 outbox cursor 的分配顺序与 message seq 一致。重复的 `client_message_id` 返回既有 message，不重复创建 outbox row 或实时事件。

构造 payload 所需的 conversation、message 和 sender 数据都从同一事务读取。现有 text、markdown、image、file 创建路径不再在 HTTP handler 返回后单独调用 `dispatchAppMessageCreatedEvent`。

## 有界重放与 Assistant 事件队列

### Server 分页重放

`replayAppEvents` 使用 cursor keyset pagination，每页最多 100 行：

```text
WHERE app_id = ? AND id > last_cursor
ORDER BY id ASC
LIMIT 100
```

每页按顺序调用 `EnqueueReliable`，完成一页后才加载下一页。这样 server 内存与单页大小成正比，不随断线期间累计事件总数增长。

### Server Response 准入与公平调度

`appconnection.Connection` 为 event/replay 与 request response 使用两个独立的有界 channel；两者容量都由 connection send buffer 控制。live event 和 replay event 进入 event channel，所有正常 response 与协议/请求错误 response 都通过 `EnqueueResponse` 可靠准入 response channel。可靠准入等待 channel 槽位时同时监听 `done`，因此 `Close` 会解除 replay 或 response producer 的阻塞。

writer 常态使用 response-first 调度，使 history、ACK 等请求不会排在 replay backlog 之后。为避免持续 response backlog 饿死 event 或 ping，writer 连续最多发送 16 个 response；到达公平点后，先处理一个 ready ping，再处理一个 ready event，然后恢复 response-first。ping 与 event 同时 ready 时两者都会在该公平点取得有界进展。

这关闭了原有的停滞闭环：replay event backlog 填满共享 send channel 后，history/ACK response 可能被非阻塞 admission 静默丢弃；assistant 因等待 response 无法处理并 ACK 队首，事件队列继续 overflow，重连后又从相同 cursor 重放而没有进展。独立 response channel、可靠 response admission 与有界公平调度保证重连后的稳定请求能够获得 response，使 ACK cursor 继续推进。

### Assistant 有界队列

assistant 进程级事件队列最多保存 256 个尚未完成的 envelope。reader 收到 response 时仍立即交给 `Reliable App Requester`；收到 event 时尝试入队：

- 已 ACK cursor 或已在队列中的重复 cursor：按现有去重/唤醒规则处理，不消耗新槽位。
- 队列有空间：加入 FIFO 队列。
- 队列已满：返回明确的 `event queue full` 结果，要求 WebSocket Manager 关闭当前 generation。

不能在 reader 中等待队列腾出空间，因为队首处理可能正在等待同一 WebSocket 上的 response；阻塞 reader 会造成协议死锁。关闭 generation 后，server 保留所有未 ACK outbox row；重连时从最后 ACK cursor 继续分页补投。

WebSocket Manager 的消息回调因此返回处理结果。response 永远被接受；event 入队失败会终止当前 generation，但不会取消 Session Manager 或 pending agent job。

## 双重 Sequence Watermark

全局、有限容量的 `conversation ID -> last seen seq` watermark 继续覆盖 session 已被一小时 idle cleanup 删除后的近期重复事件。

只要 conversation job 仍存在，`conversationAgentRunner.Start` 在 `Session.Append` 前还必须检查：

```text
prepared.MessageSeq > 0 && prepared.MessageSeq <= job.lastSeenSeq
```

命中时作为已接受的重复事件返回，不再次追加。这样全局 watermark 的容量淘汰不会削弱仍存活 job 自身的去重状态。

## 永久认证错误

WebSocket Manager 将 HTTP 401/403 转换为可用 `errors.Is` 识别的 permanent authentication error。该错误不进入瞬时连接重试，也不被 `Client.Run` 的外层 30 秒连接周期吞掉；`Client.Run` 直接返回错误，由进程入口记录并退出。

普通网络错误、读写错误和一次连接周期的十次重试耗尽仍沿用原有行为，不取消 agent session。

## 精确 1 MiB 出站限制

server 在写出 envelope 前使用 `json.Marshal` 得到完整 message bytes，并对同一份 bytes 执行长度检查和 `WriteMessage(websocket.TextMessage, encoded)`。不再在检查后调用会追加换行符的 `WriteJSON`。

- `len(encoded) <= 1 << 20`：发送原 bytes。
- response 超限：编码并发送小型 `response_too_large` envelope。
- event 超限：保持原设计的记录并跳过语义。

## 并发与失败语义

- conversation 行锁提供同会话 seq 与 outbox cursor 的共同顺序边界。
- `appEventMu` 继续保护连接注册/重放与 live delivery 之间不存在 snapshot-to-live 缝隙。
- server event/replay 与 response 使用独立有界队列；可靠 admission 在 connection `done` 关闭后解除阻塞。
- response-first writer 每连续 16 个 response 进入公平点，保证 ready ping 和 ready event 都有有界进展。
- assistant 队列满只使当前 generation 失效，不影响 event worker、Session Manager 或 agent job context。
- 未成功提交 Session Manager 或未成功发送终态 fallback 的队首事件仍不 ACK，也不允许更高 cursor 越过。
- 永久认证错误停止连接循环；所有瞬时错误仍由现有指数退避和十次重试策略处理。

## 测试要求

- 用确定性并发测试证明：较小 seq 即使在 HTTP handler 层延迟，也不能晚于较大 seq 写入同一 app 的 outbox。
- 重复 `client_message_id` 不产生第二条 outbox row。
- 全局 watermark 淘汰后，仍存活 job 会拒绝相同或更小 seq。
- server 重放超过一页时按 cursor 有序，单次查询不超过 100 行。
- server event queue 已满时，request response 仍先于已排队 event 写出。
- 持续 response backlog 下 event 与 ping 都在 16-response 公平边界内取得进展；ping 与 event 同时 ready 时两者都被处理。
- assistant 第 257 个未完成 event 使当前 generation 断开；response 仍能在队列满时正常路由。
- 队列溢出重连后，未 ACK event 会重新投递且不会重复执行已处理任务。
- 使用真实 `Client.Run` 覆盖 257-event overflow、关闭当前 generation、重连、复用稳定 request ID、依次 ACK cursor 1..257，并证明重复 message seq 只触发一次 agent。
- 401/403 只拨号一次并由 `Client.Run` 返回 permanent error。
- marshal 后恰好 1 MiB 的 server envelope 可被 1 MiB read limit 接收；超过一字节时触发现有替代/跳过行为。
- assistant/server 全量测试和相关 `go test -race` 通过。

## 成功标准

- 并发同会话触发不会因 cursor/seq 逆序而丢失。
- session job 和全局 watermark 两层去重均有效。
- 任意数量的未 ACK outbox row 不再导致单次 server 查询或 assistant 内存队列无界增长。
- response 不会被 replay backlog 丢弃或饿死，assistant event overflow 重连后 history/ACK 能继续推进。
- 永久认证错误不会周期性重拨。
- server 实际 WebSocket payload 与检查长度完全一致，严格执行 1 MiB 边界。
