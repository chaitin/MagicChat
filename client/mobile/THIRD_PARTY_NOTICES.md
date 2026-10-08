# MiSans 字体来源

界面使用小米官方压缩包中的 MiSans Regular、Medium、Demibold TTF 原始文件，分别映射为 400、500、600，统一存放在仓库根目录 `assets/fonts/misans/`。来源：https://hyperos.mi.com/font-download/MiSans.zip

| 文件 | SHA-256 |
| --- | --- |
| MiSans-Regular.ttf | `9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6` |
| MiSans-Medium.ttf | `b03e98374e971594b0b7a9706d0704241f76e1b88556cdda79c5039ef8a638d1` |
| MiSans-Demibold.ttf | `209bc982dda59dc05f6dda1c6145b91dea8fd24a28f903fe7f009313b06dc8e3` |

`client/mobile/assets/fonts/misans` 是指向共享字体目录的 Git 软链接；在 Windows 检出时需启用符号链接支持（例如开发者模式与 `core.symlinks=true`），否则 Metro 无法读取字体文件。

官方压缩包未附授权文件；发布前需核对字体使用与分发条款。
