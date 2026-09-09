# Push Gateway Web

即应公共 Push Gateway 的独立管理前端，沿用 `admin-web` 的主题、字体、布局和 UI 组件体系。

当前版本仅用于界面预览：

- 输入任意非空账号和密码即可登录；
- 服务器列表使用内置 mock 数据；
- 添加、编辑额度、启停和轮换 Key 仅修改当前页面内存；
- 刷新页面后 mock 数据恢复；
- 尚未连接 Push Gateway 管理 API。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址为 <http://localhost:20061>。

## 校验

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
