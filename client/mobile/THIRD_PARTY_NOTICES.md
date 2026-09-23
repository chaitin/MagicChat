# MiSans 字体来源

界面使用小米官方压缩包中的 MiSans Regular、Medium、Bold TTF 原始文件，统一存放在仓库根目录 `assets/fonts/misans/`。来源：https://hyperos.mi.com/font-download/MiSans.zip

| 文件 | SHA-256 |
| --- | --- |
| MiSans-Regular.ttf | `9c120f0a849bc0aa5048daae2a3c0f6eecd828b5b33fce682a9622833f5feea6` |
| MiSans-Medium.ttf | `b03e98374e971594b0b7a9706d0704241f76e1b88556cdda79c5039ef8a638d1` |
| MiSans-Bold.ttf | `d0c1d327952ed935e86fb78a97a6c182b44f2c2b08777326786b1f8b26d1fe1e` |

`client/mobile/assets/fonts/misans` 是指向共享字体目录的 Git 软链接；在 Windows 检出时需启用符号链接支持（例如开发者模式与 `core.symlinks=true`），否则 Metro 无法读取字体文件。

官方压缩包未附授权文件；发布前需核对字体使用与分发条款。
