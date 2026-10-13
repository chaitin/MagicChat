# MiSans 字体来源

普通界面文字使用小米官方压缩包中的 MiSans Regular、Medium、Demibold TTF 原始文件，分别映射为 400、500、600，统一存放在仓库根目录 `assets/fonts/misans/`。来源：https://hyperos.mi.com/font-download/MiSans.zip

| 文件 | SHA-256 |
| --- | --- |
| MiSans-Regular.ttf | `9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6` |
| MiSans-Medium.ttf | `b03e98374e971594b0b7a9706d0704241f76e1b88556cdda79c5039ef8a638d1` |
| MiSans-Demibold.ttf | `209bc982dda59dc05f6dda1c6145b91dea8fd24a28f903fe7f009313b06dc8e3` |

`client/mobile/assets/fonts/misans` 是指向共享字体目录的 Git 软链接；在 Windows 检出时需启用符号链接支持（例如开发者模式与 `core.symlinks=true`），否则 Metro 无法读取字体文件。

官方压缩包未附授权文件；发布前需核对字体使用与分发条款。

## Emoji 字体

`assets/fonts/emoji/JiyingEmoji.ttf` 的彩色字形来自 Desktop 使用的 `@infolektuell/noto-color-emoji@0.2.0`，原字体为 Noto Color Emoji（Google，OFL-1.1），版本 `2.042`。字体和原始授权保存在仓库共享目录 `assets/fonts/noto-color-emoji/`，Mobile 的 `assets/fonts/emoji` 通过 Git 软链接引用（与现有 MiSans 一样，Windows 检出需要启用符号链接支持）。

原浏览器 WOFF2/COLRv1 子集不能直接用于 React Native。`scripts/build-emoji-font.py` 合并原始 cmap/GSUB，并将同源彩色字形转换为 64 ppem PNG：Android 使用 CBDT/CBLC，iOS 使用 sbix。重建方式与固定工具版本见脚本说明。生成字体同时合入 MiSans Regular 的普通文字字形，原始 MiSans 文件保持不变；此组合字体仅用于只读 Text 的 emoji 片段，不用于可编辑输入框。另生成不含 sbix/普通文字 cmap 的 `JiyingEmojiAndroid.ttf`，供 Android 10+ 原生 fallback 使用。合并前剔除不可达 emoji 字形，统一 UPEM；重映射 CBDT/CBLC、sbix 与 GSUB，补齐变体选择和混合文本的 ccmp。这里没有采用手机系统或厂商的 emoji 字形。组合字体包含 MiSans 与 Noto 的各自字形，不意味着 MiSans 获得 OFL 授权；发布前仍需核对 MiSans 的使用、修改与分发条款。

共享 Text 组件为完整 emoji 序列切换到 `JiyingEmoji`，覆盖面板、回应、聊天文本和列表预览；共享 TextInput（含 XGUIInput、AppInput）在 Android 10+ 通过本地 `MagicChatFontFallback` 模块使用 `Typeface.CustomFallbackBuilder`：MiSans 为主字体、独立 Android Emoji 字体为 custom fallback，并保留系统 sans-serif fallback；Android 9 及更早版本不主动设置自定义字体，使用系统字体。iOS 通过同一本地模块的专用 `MiSansEmojiFallback-*` 别名构建 `UIFontDescriptor.cascadeList`，以原始 MiSans 为主字体、独立 `JiyingEmojiIOS.ttf` sbix 字体为级联字体；通过 UIFont 的字体查询入口仅适配专用别名，其他调用保留原路径。注册失败时保留 MiSans 和系统 Emoji 回退。该 iOS 接入尚未通过 Xcode 编译或实机验收。两端输入框均不再使用组合字体。第三方原生界面、键盘和明确指定其他字体的组件不受该字体覆盖。尚需在 Android/iOS 实机核对字体加载、组合字形与基线，不能视为跨平台逐像素一致的验收结论。
