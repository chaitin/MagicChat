# Push Gateway Web

即应公共 Push Gateway 的独立管理前端，沿用 `admin-web` 的主题、字体、布局和 UI 组件体系。

管理端通过同源 `/api/admin/v1` 接口完成登录、服务器管理、额度管理和 Server Key 操作。认证使用服务端 HttpOnly Session Cookie；页面不在 LocalStorage 中保存会话或 Server Key。

## 本地运行

先启动 Push Gateway，并配置管理账户。开发服务默认将 `/api` 代理到 `http://127.0.0.1:8080`：

```bash
pnpm install
pnpm dev
```

默认地址为 <http://localhost:20061>。如 Gateway 使用其他地址，可设置 `PUSH_GATEWAY_API_URL`。本地 Gateway 需要设置 `PUSH_ADMIN_COOKIE_SECURE=false`，生产必须保持为 `true`。

生产镜像使用 `/admin/` 作为前端基础路径。反向代理需要将 `/api/*` 转发至 Push Gateway，并将 `/admin/*` 去掉前缀后转发至本镜像的 `8080` 端口。

## 校验

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
