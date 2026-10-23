# 字体来源

普通界面文字和输入框默认使用手机系统字体，不再加载或强制设置 MiSans；字号不跟随系统字号缩放。代码块等明确指定等宽字体的内容保留其语义。MiSans Regular 的部分字形仍保留在已生成的只读表情组合字体中，仅供完整表情序列使用，因此保留来源和授权说明。

## MiSans 字体素材

仓库共享素材来自小米官方压缩包中的 MiSans Regular、Medium、Demibold TTF 原始文件，统一存放在仓库根目录 `assets/fonts/misans/`。来源：https://hyperos.mi.com/font-download/MiSans.zip

| 文件 | SHA-256 |
| --- | --- |
| MiSans-Regular.ttf | `9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6` |
| MiSans-Medium.ttf | `b03e98374e971594b0b7a9706d0704241f76e1b88556cdda79c5039ef8a638d1` |
| MiSans-Demibold.ttf | `209bc982dda59dc05f6dda1c6145b91dea8fd24a28f903fe7f009313b06dc8e3` |

`client/mobile/assets/fonts/misans` 是指向共享字体目录的 Git 软链接；在 Windows 检出时需启用符号链接支持（例如开发者模式与 `core.symlinks=true`），否则 Metro 无法读取字体文件。

官方压缩包未附授权文件；发布前需核对字体使用与分发条款。

## JetBrains Mono 代码字体

Markdown 代码块与行内代码使用 JetBrains Mono `v2.304` 的原始 TTF，仅影响代码，不替换界面正文或 Emoji 字体。来源：https://github.com/JetBrains/JetBrainsMono/tree/v2.304/fonts/ttf 。字体及 SIL Open Font License 1.1 原文存放于 `assets/fonts/jetbrains-mono/`。

通过现有 `expo-font` 启动加载普通、半粗、斜体与半粗斜体，按代码所在文本的样式选择对应文件，不使用系统字体合成字重或斜体。

| 文件 | SHA-256 |
| --- | --- |
| JetBrainsMono-Regular.ttf | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` |
| JetBrainsMono-SemiBold.ttf | `1b3bfa1ed5665a4ce3f9feb68d2d4e40e70bf8b4b7d9a3edd418f321b4e166a0` |
| JetBrainsMono-Italic.ttf | `9d0a1f7a708e6af183f1193b7e81d40da294f5c67682c085d8401c60aac8ded4` |
| JetBrainsMono-SemiBoldItalic.ttf | `3b3000507a7285872395ddbb4e53a28f07910dbf494fb0d5e1421dd60b5d8436` |

## Emoji 字体

`assets/fonts/emoji/JiyingEmoji.ttf` 的彩色字形来自 Desktop 使用的 `@infolektuell/noto-color-emoji@0.2.0`，原字体为 Noto Color Emoji（Google，OFL-1.1），版本 `2.042`。字体和原始授权保存在仓库共享目录 `assets/fonts/noto-color-emoji/`，Mobile 的 `assets/fonts/emoji` 通过 Git 软链接引用（与现有 MiSans 一样，Windows 检出需要启用符号链接支持）。

原浏览器 WOFF2/COLRv1 子集不能直接用于 React Native。`scripts/build-emoji-font.py` 合并原始 cmap/GSUB，并将同源彩色字形转换为 64 ppem PNG：Android 使用 CBDT/CBLC，iOS 使用 sbix。重建方式与固定工具版本见脚本说明。生成字体同时合入 MiSans Regular 的普通文字字形，原始 MiSans 文件保持不变；此组合字体仅用于只读 Text 的 emoji 片段，不用于可编辑输入框。另生成不含 sbix/普通字母 cmap 的 `JiyingEmojiAndroid.ttf`，供 Android 10+ 原生输入框的表情片段使用；其中的数字、井号、星号仅为键帽表情的完整组合保留，不能将该字体用于整个输入框。合并前剔除不可达 emoji 字形，统一 UPEM；重映射 CBDT/CBLC、sbix 与 GSUB，补齐变体选择和混合文本的 ccmp。这里没有采用手机系统或厂商的 emoji 字形。组合字体包含 MiSans 与 Noto 的各自字形，不意味着 MiSans 获得 OFL 授权；发布前仍需核对 MiSans 的使用、修改与分发条款。

共享 Text 组件仅为完整 emoji 序列切换到 `JiyingEmoji`，普通文字由系统字体渲染，覆盖面板、回应、聊天文本和列表预览。共享 TextInput（含 XGUIInput、AppInput）默认保留系统字体；Android 10+ 通过本地 `MagicChatFontFallback` 模块监听输入框文字，以 ICU 字素边界识别完整表情，仅为表情添加独立 Android 字体的 `MetricAffectingSpan`，不替换文字、选区或输入法组合标记，普通数字不使用表情素材里的 MiSans 字形；Android 9 及更早版本保持原有限制，输入框使用系统字体和系统表情。iOS 通过专用 `SystemEmojiFallback-*` 别名构建 CoreText 字体级联，以对应字重的 `UIFont.systemFont` 为主字体，优先使用独立 `JiyingEmojiIOS.ttf` sbix 表情字体，并保留系统默认的中文等语言回退；仅拦截这些专用别名的字体查询，其他调用保留原路径。原生模块缺失或注册失败时输入框回退到系统字体和系统表情。iOS 接入尚未通过 Xcode 编译或实机验收。两端输入框均不使用只读组合字体。第三方原生界面和键盘不受该字体覆盖。尚需在 Android/iOS 实机核对组合字形、输入法行为与基线，不能视为跨平台逐像素一致的验收结论。
