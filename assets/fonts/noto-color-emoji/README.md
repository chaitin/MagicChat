# 同源 Emoji 字体

- 彩色字形来源：Desktop 的 `@infolektuell/noto-color-emoji@0.2.0`，Noto Color Emoji `2.042`，按 64 ppem 转为 PNG 位图。
- `JiyingEmoji.ttf`：只读 Text 中的 Emoji 片段使用，包含 CBDT/CBLC、sbix、GSUB，以及合入的 MiSans Regular 轮廓。内部名称为 `Jiying Emoji Input` / `JiyingEmojiInput`，通过 expo-font 别名 `JiyingEmoji` 加载；不能直接用于 Android 输入框。
- `JiyingEmojiAndroid.ttf`：Android 10+ 输入框的独立 Emoji fallback 字体，包含 CBDT/CBLC 和 GSUB，不含 sbix 或普通中英文字 cmap。
- `JiyingEmojiIOS.ttf`：iOS 输入框的独立 Emoji cascade 字体，包含 sbix 和 GSUB，不含 CBDT/CBLC 或普通中英文字 cmap。
- Noto 原始许可：`OFL.txt`（OFL-1.1）。MiSans 原文件保持不变，合入的 MiSans 字形仍受小米各自授权条款约束，并非获得 OFL 授权；发布前需核对其使用、修改和分发条款。

Mobile 通过 `client/mobile/assets/fonts/emoji` 软链接引用本目录。Web 支持 COLRv1 的浏览器仍使用原包的 WOFF2 子集，不使用这些输入框字体。

## 重建

先安装 Desktop 已锁定的依赖，再在隔离 Python 环境中安装 `blackrenderer[skia]==0.8.2`、`fonttools[woff]==4.66.1` 及 `uharfbuzz`，从仓库根目录运行：

```sh
python client/mobile/scripts/build-emoji-font.py
```

已有 `JiyingEmoji.ttf` 时，仅重新生成平台输入框资源可运行：

```sh
python client/mobile/scripts/build-emoji-font.py --android-fallback
python client/mobile/scripts/build-emoji-font.py --ios-fallback
```

Android 10+ 使用原生 `Typeface.CustomFallbackBuilder`：MiSans 主字体加独立 Emoji fallback；Android 9 及更早版本不主动为输入框设置自定义字体。iOS 使用原生 `UIFontDescriptor.cascadeList`，并仅适配专用字体别名；注册失败时保留原字体和系统 Emoji 回退。

这些是同源字形，不是逐像素一致承诺：抗锯齿和缩放由平台控制。Android 版本已构建并安装，仍需确认实际输入显示；iOS 级联尚未通过 Xcode 编译或实机验收。
