# Push Gateway

Public, capability-based push notification gateway for the MagicChat mobile app and privately deployed MagicChat servers.

The gateway stores no MagicChat account, conversation, server URL, or message content. A mobile installation creates a short capability (`grant_id` + `send_token`) and delegates it to the private server it is currently signed in to. The private server can only enqueue fixed-template notifications for that installation.

## Current milestone

Implemented:

- PostgreSQL migrations embedded in the binary
- versioned provider-token encryption with rolling keyring rotation
- installation registration and provider-token rotation
- one active grant per installation
- grant renewal, revocation, and expiration
- idempotent fixed-template notification jobs
- independently authenticated private servers with enable/disable and key rotation
- Beijing-calendar-day quotas charged once per accepted unique job
- authenticated management sessions and server-management APIs
- database-backed per-IP, global, grant-rotation, admin-login, and per-grant rate limiting
- PostgreSQL-backed retry worker
- bounded retention for jobs, grants, and abandoned installations
- invalid-device revocation behavior
- APNs HTTP/2 provider with token authentication, sandbox/production routing, collapse IDs, and error classification
- JPush Android REST provider with RegistrationID targeting, fixed anonymous extras, TTL forwarding, and error classification
- fake provider for local and automated testing
- `/api`-scoped health, metrics, OpenAPI, and v1 routes

The private MagicChat server integration is implemented with a fixed production Gateway URL, encrypted delegated grants, durable local jobs, and authenticated notification-route resolution.

Not implemented yet:

- JPush OEM-channel real-device validation and Getui fallback evaluation
- provider delivery-receipt polling

## Run locally

Set the variables documented in `.env.example`, create the PostgreSQL database, then run. `PUSH_PROVIDERS` is required explicitly so a production deployment cannot silently fall back to the fake provider. Use `apns,jpush` for the official iOS and Android channels; JPush additionally requires `JPUSH_APP_KEY` and `JPUSH_MASTER_SECRET`:

```sh
go run ./cmd/gateway
```

No development service is started automatically by tests or builds.

Production traffic must terminate TLS at a trusted reverse proxy. Configure that proxy to replace (not append untrusted values to) `X-Forwarded-For`, and list its network in `TRUSTED_PROXY_CIDRS`; otherwise the gateway deliberately derives rate-limit identity from the direct peer address. Never expose the plain HTTP listener directly to the public internet.

To rotate `DATA_ENCRYPTION_KEY`, move the old value into `DATA_ENCRYPTION_PREVIOUS_KEYS` and deploy the new value as the current key. Active installation tokens are lazily re-encrypted by the worker; retain previous keys until old-key ciphertext has drained.

`INSTALLATION_RETENTION` controls how long expired/revoked grants and abandoned installations remain after they are no longer active. It must not be shorter than `JOB_RETENTION`.

The management API is enabled when `PUSH_ADMIN_USERNAME` and one password credential are configured. `PUSH_ADMIN_PASSWORD` accepts plaintext from a protected environment file and is converted to an Argon2id hash during startup; the plaintext is not retained by the service. Alternatively, set `PUSH_ADMIN_PASSWORD_HASH` to an Argon2id PHC hash generated with `go run ./cmd/hash-password`. Never configure both forms. Admin sessions always last 12 hours. Session cookies automatically use `Secure` for HTTPS requests, including TLS terminated by a reverse proxy that supplies `X-Forwarded-Proto: https`.

Notification admission requires `X-MagicChat-Server-Key` in addition to the grant Bearer token. Server keys are created in the management console. The active key is encrypted at rest so an administrator can reveal it; authentication uses a separate SHA-256 hash. Rotating a key erases the old ciphertext and revokes the old key immediately.

## API

- `POST /api/v1/installations`
- `PUT /api/v1/installations/{installation_id}/provider-token`
- `POST /api/v1/installations/{installation_id}/active-grant`
- `POST /api/v1/grants/{grant_id}/renew`
- `DELETE /api/v1/grants/{grant_id}`
- `POST /api/v1/grants/{grant_id}/notifications`
- `POST /api/admin/v1/session`
- `GET|DELETE /api/admin/v1/session`
- `GET|POST /api/admin/v1/servers`
- `PATCH /api/admin/v1/servers/{server_id}`
- `POST /api/admin/v1/servers/{server_id}/enable`
- `POST /api/admin/v1/servers/{server_id}/disable`
- `POST /api/admin/v1/servers/{server_id}/key/reveal`
- `POST /api/admin/v1/servers/{server_id}/key/rotate`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/metrics`
- `GET /api/openapi.json`

`GET /api/metrics` exposes only anonymous operational aggregates:

- `push_gateway_jobs{status}`
- `push_gateway_grants{status}`
- `push_gateway_installations{provider,platform,status}`
- `push_gateway_recent_failed_jobs`
- `push_gateway_recent_failed_jobs_by_code{code}`
- `push_gateway_oldest_pending_job_age_seconds`

No installation ID, grant ID, provider token, route token, user identity, private-server address, conversation ID, or message ID is included.
