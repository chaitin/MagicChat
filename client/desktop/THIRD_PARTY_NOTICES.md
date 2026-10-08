# 第三方组件许可

## MiSans

本应用界面使用小米 MiSans 字体。官方来源：https://hyperos.mi.com/font-download/MiSans.zip

使用压缩包 `MiSans/woff2/` 下未经修改的 Regular、Medium、Demibold，在界面中分别映射为 400、500、600。文件统一保存在仓库根目录 `assets/fonts/misans/`，由各客户端直接引用。压缩包内未附授权文件；发布前需核对官方字体使用与分发条款。

| 文件                  | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| MiSans-Regular.woff2  | `d704c1a932c0bd7e8a071d276cd81c0ed0c9fecfa26ac234f4bed0559fe1cb2d` |
| MiSans-Medium.woff2   | `44e28ca6c2f0ca79829f192831ef87b5eec7c464f5cfb7a83467f57bb6e58114` |
| MiSans-Demibold.woff2 | `7afe3737efaf6a137db0ef4857fbe4033a8802756485ebc7f008e96a4bdedcf2` |

## shadcn/ui

来源：

- https://ui.shadcn.com/r/styles/new-york-v4/login-03.json
- https://ui.shadcn.com/r/styles/new-york-v4/sidebar-13.json

登录页按官方 `login-03` 源码适配，设置对话框按官方 `sidebar-13` 源码适配。Button、Input、Card、Field、Label、Separator、Dialog、Sidebar、Sheet、Tooltip、Skeleton、Breadcrumb、Item 和 Tabs 由官方 CLI 安装。`src/renderer/components/ui/` 中这些组件保留官方实现（仅按项目规则格式化及本地化关闭按钮的读屏文本）。

`src/renderer/components/login-form.tsx` 保留 `login-03` 的单栏 Card、居中 CardHeader、CardContent 与表单间距，提取 LoginFrame 供连接/登录成功状态复用；文案本地化，替换顶部第三方登录按钮为当前支持的登录方式，接入认证 hook。`src/renderer/components/settings-dialog.tsx` 保留 `sidebar-13` 的 Dialog、SidebarProvider、Sidebar 菜单与内容区结构，将示例分类和占位内容替换为真实的外观与关于设置。

`src/renderer/public/placeholder.svg` 来自 https://ui.shadcn.com/placeholder.svg，是此前保留的官方原版占位图；当前 login-03 登录页不再引用。

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Hugeicons

界面图标使用 `@hugeicons/react` 1.1.10 和 `@hugeicons/core-free-icons` 4.3.2；原 `lucide-react` 依赖已移除。许可全文保存在 `src/renderer/public/licenses/hugeicons.txt`，随应用构建复制。

MIT License

Copyright (c) 2025 Hugeicons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## beUI

来源：

- https://beui.dev/r/action-swap
- https://beui.dev/r/switch.json

`src/renderer/components/motion/action-swap.tsx` 摘取并适配 Action Swap 的 roll 文本与图标插槽，以及其弹簧参数；没有引入完整按钮或其他动画变体。增加静态的减少动态效果分支，并将动画层设为装饰内容，避免读屏重复读取。

`src/renderer/components/motion/switch.tsx` 使用 beUI Switch，按项目格式调整代码排版，增加较小尺寸选项。

MIT License

Copyright (c) 2026 Saurabh Chauhan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
