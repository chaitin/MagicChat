import 'package:flutter/services.dart';

/// 统一通知桥接。原生端可实现 `magicchat/notifications`，未实现时保持静默，
/// 不影响 Web、Linux 或无通知权限的运行环境。
class LocalNotificationService {
  const LocalNotificationService(
      {MethodChannel channel = const MethodChannel('magicchat/notifications')})
      : _channel = channel;
  final MethodChannel _channel;

  Future<void> showMessage({
    required String conversationId,
    required String title,
    required String body,
  }) async {
    try {
      await _channel.invokeMethod<void>('showMessage', {
        'conversation_id': conversationId,
        'title': title,
        'body': body,
      });
    } on MissingPluginException {
      // Web/Linux without a notification adapter are valid fallback targets.
    } on PlatformException {
      // Permission or provider failures must not interrupt message sync.
    }
  }
}
