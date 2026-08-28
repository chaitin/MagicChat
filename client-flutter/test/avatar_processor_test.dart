import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:magicchat_client/data/avatar_processor.dart';

void main() {
  test('头像统一裁剪为 256x256 WebP', () {
    final source = image.Image(width: 640, height: 320);
    final input = Uint8List.fromList(image.encodePng(source));
    final output = const AvatarProcessor().process(input);
    final decoded = image.decodeWebP(output);
    expect(decoded, isNotNull);
    expect(decoded!.width, 256);
    expect(decoded.height, 256);
  });
}
