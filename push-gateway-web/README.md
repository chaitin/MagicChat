# Push Gateway Web

即应公共 Push Gateway 的管理前端源码，沿用 `admin-web` 的主题、字体、布局和 UI 组件体系。生产构建会嵌入 `push-gateway` 二进制，不单独发布或运行前端容器。

管理端通过同源 `/api/admin/v1` 接口完成登录、服务器管理、额度管理和 Server Key 操作。认证使用服务端 HttpOnly Session Cookie；页面不在 LocalStorage 中保存会话或 Server Key。

## 本地运行

先启动 Push Gateway，并配置管理账户。开发服务默认将 `/api` 代理到 `http://127.0.0.1:20062`：

```bash
pnpm install
pnpm dev
```

默认地址为 <http://localhost:20061>。如 Gateway 使用其他地址，可设置 `PUSH_GATEWAY_API_URL`。

生产构建使用 `/admin/` 作为前端基础路径。Push Gateway 直接提供 `/admin/**` 静态资源和 SPA 回退，因此反向代理只需将流量转发到 Gateway。

## 校验

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
