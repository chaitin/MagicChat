import 'dart:typed_data';
import 'package:image/image.dart' as image;

/// 将头像裁剪为服务端要求的 256x256 WebP。
class AvatarProcessor {
  const AvatarProcessor();

  Uint8List process(Uint8List bytes) {
    final source = image.decodeImage(bytes);
    if (source == null) throw const FormatException('无法读取头像图片');
    final cropped = image.copyResizeCropSquare(source, size: 256);
    final encoded = image.encodeWebP(cropped);
    return Uint8List.fromList(encoded);
  }
}
