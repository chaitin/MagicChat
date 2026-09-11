# 即应官网首页

`homepage` 是即应官网的静态生成实现。页面使用 Astro 构建，正文和 SEO 元信息直接输出为 HTML，不依赖客户端路由或 JavaScript 渲染。

## 本地开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run check
npm run build
npm run preview
```

生产文件输出到 `dist/`。正式部署时设置站点域名和部署路径，用于生成 canonical、sitemap 与静态资源地址：

```bash
SITE_URL=https://example.com PUBLIC_BASE_PATH=/ npm run build
```

## 样式与字体

项目使用 Astro、React 集成和 Tailwind CSS v4。`BaseLayout.astro` 统一加载独立的 `SiteHeader.astro`、`SiteFooter.astro` 组件，所有内容页只提供正文。页头导航为帮助文档，快捷入口为 GitHub 和在线体验。

基础样式位于 `src/styles/global.css`；整站配色、点阵背景和页头页脚位于 `src/styles/site.css`；首页内容使用 `src/styles/homepage.css`，协议页面的阅读布局使用 `src/styles/legal.css`。

全站最终字号由 `src/styles/typography.css` 统一管理，通过语义分组覆盖组件中的旧字号。主标题 48px、分区标题 32px、小标题 18px、正文 14px、辅助文字 12px；800px 及以下仅将主标题和分区标题改为 32px、24px。品牌固定 24px，正文行高 1.8，按钮和导航行高 1.4。新增文案按这些角色归类，避免增加零散字号。

shadcn/ui 配置位于 `components.json`，组件源码保存在 `src/components/ui/`，`@/` 指向 `src/`。Button 基于官方 New York / Radix 实现，全站实际操作控件共用该组件：`HeaderActions.tsx` 提供页头按钮，`ActionButton.tsx` 提供 Hero、下载、部署、文档与返回操作，`WorkspaceTab.tsx` 提供功能切换，`FaqQuestion.tsx` 通过 `asChild` 保留原生 summary 展开语义。普通导航和正文链接继续使用语义化链接，产品示意图里的控件仅作展示。

这些组件均由 Astro 服务端渲染，不使用 `client:*` 指令，无需加载客户端 React。操作按钮默认通过 `data-motion` 启用统一的悬停颜色、边框、阴影和按压反馈；标签页和 FAQ 设为 `motion={false}`，避免布局位移。系统开启减少动态效果时关闭位移与缩放，保留清晰的颜色及阴影状态。

`src/styles/shadcn.css` 提供 Tailwind utilities、深色变体和映射到 Tailwind teal 主题的语义颜色。保留现有 CSS reset，不重复引入 Tailwind Preflight；utilities 使用非分层输出，以便覆盖现有非分层基础样式。新增交互组件时，在完整的 React 组件边界上按需使用 `client:load` 或 `client:visible`。

在 `homepage` 目录添加后续组件：

```bash
pnpm dlx shadcn@latest add dialog
```

组件主题统一在 `shadcn.css` 中维护，页面配色继续由 `site.css` 提供。

全站采用近黑背景、Tailwind v4 `teal-500` 强调色与细边框，设计变量集中在 `site.css` 开头；深色使用 `teal-600` / `teal-950`，半透明背景、边框和光晕通过 `color-mix` 从主色派生。页脚使用浅白栏目标题、冷灰链接及主题色品牌。`StudioHero.astro` 展示消息到任务确认的协作示意，`StudioWorkspace.astro` 提供支持键盘切换的四组场景标签页。FAQ 使用原生展开列表；禁用 JavaScript 时仍可阅读全部场景。移动端布局在 800px、520px 处调整，并遵循系统减少动态效果的设置。

字体使用 [Maple Mono CN v7.9](https://github.com/subframe7536/maple-font/releases/tag/v7.9)，中文基于资源圆体，支持简体、繁体中文及日文。中文版本是静态字体，使用官方 Regular（400）、Medium（500）、SemiBold（600）、Bold（700）四个字重。字体、来源元信息和 SIL OFL-1.1 许可证位于 `src/assets/fonts/maple-mono-cn/`，正文、标题和英文标签均使用本地字体，不请求外部字体 CDN。

每个字重包含 26 个切片，保留原字体的 22,731 个字符。当前站点常用字符单独放在小切片中，其余字符也保留为按需加载的扩展切片；浏览器根据 `unicode-range` 和实际字重请求文件，优先使用 WOFF2，并提供 WOFF 后备。Vite 为字体资源生成内容哈希并适配 `PUBLIC_BASE_PATH`。四个字重的全部 WOFF2 约 24.23 MiB，WOFF 约 32.11 MiB，访问页面不会下载整套字体。

普通开发和生产构建直接使用已入库文件。只有重新划分切片或更新字体时才需要 Python 3.11+ 转换工具。先从上述官方 Release 下载 `MapleMono-CN-unhinted.zip`，再执行：

```bash
python3 -m venv .venv-fonts
.venv-fonts/bin/pip install -r scripts/requirements-fonts.txt
.venv-fonts/bin/python scripts/sync-fonts.py --archive /path/to/MapleMono-CN-unhinted.zip
```

已安装 Python 依赖时，也可执行 `npm run fonts:sync -- --archive /path/to/MapleMono-CN-unhinted.zip`。脚本校验官方归档的 SHA-256、源字体字重及字符覆盖，生成 WOFF2、WOFF 和 CSS，并验证切片没有丢失字符。新增文案可直接使用现有扩展切片；重新生成只用于优化常用字符分组。

## Google Analytics

官网默认使用 GA4 Measurement ID `G-BW65KYSTXM`，页面加载后直接启用统计。需要切换到其他 GA4 属性时，可在构建或部署环境中覆盖：

```bash
PUBLIC_GA_ID=G-XXXXXXXXXX npm run build
```

格式无效的 Measurement ID 不会加载 Google Analytics。

## SEO

- 静态 HTML、语义化标题结构与可抓取正文
- canonical、robots、Open Graph、Twitter Card 与 `hreflang`
- Organization 与 SoftwareApplication JSON-LD
- 构建生成 `/sitemap.xml` 和 `/robots.txt`
- 独立 `/user-service/` 服务协议页，以及 `/privacy-policy/`、`/user-agreement/` 文档页

## Docker 部署

GitHub Actions 在 `main` 分支和版本标签更新时构建并推送官网镜像：

```text
ghcr.io/chaitin/magicchat/homepage
```

生产服务器默认通过 `ghcr.1ms.run/chaitin/magicchat/homepage:latest` 镜像代理拉取。

部署前确保 `jiying.chat` 的 A/AAAA 记录指向服务器，并开放 TCP 80 和 443。然后在服务器保存 `compose.yml`，创建持久化目录并启动：

```bash
mkdir -p data/caddy/data data/caddy/config data/caddy/logs data/releases
docker compose pull
docker compose up -d
```

如果 GHCR 包不是公开的，需要先使用具有 `read:packages` 权限的 Token 登录：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
```

持久化目录用途：

- `data/caddy/data`：证书、私钥、ACME 账户和续期状态
- `data/caddy/config`：Caddy 运行配置
- `data/caddy/logs`：`access.log` 与 `error.log`
- `data/releases`：通过 `https://jiying.chat/releases/<文件名>` 发布的静态文件

`data/releases` 以只读方式挂载进容器。默认不启用目录列表，只允许访问明确的文件路径。容器健康检查会通过 Caddy 实际读取构建后的首页文件；建议另外使用外部监控定期请求 `https://jiying.chat/healthz`，覆盖 DNS、网络和证书状态。

升级使用：

```bash
docker compose pull
docker compose up -d
```

## 自动更新

仓库提供 systemd oneshot 服务和定时器，每小时检查一次 `latest` 镜像 digest。镜像没有变化时保留当前容器；有变化时执行 `docker compose up -d --pull always --remove-orphans`，证书与日志挂载不受影响。

在服务器安装并启用：

```bash
sudo install -m 0755 systemd/jiying-homepage-update /usr/local/sbin/jiying-homepage-update
sudo install -m 0644 systemd/jiying-homepage-update.service /etc/systemd/system/jiying-homepage-update.service
sudo install -m 0644 systemd/jiying-homepage-update.timer /etc/systemd/system/jiying-homepage-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now jiying-homepage-update.timer
```

查看下次执行时间和运行日志：

```bash
systemctl list-timers jiying-homepage-update.timer
journalctl -u jiying-homepage-update.service
```
