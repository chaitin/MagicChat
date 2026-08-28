import 'package:flutter/services.dart';

/// 原生 APNs/JPush 插件的最小桥接契约。
/// 插件返回 null 表示当前平台/环境暂不可用，调用方应继续正常运行。
class PushTokenProvider {
  const PushTokenProvider(
      {MethodChannel channel = const MethodChannel('magicchat/push')})
      : _channel = channel;
  final MethodChannel _channel;

  Future<PushTokenGrant?> readGrant() async {
    try {
      final value = await _channel.invokeMethod<Object?>('getGrant');
      if (value is! Map) return null;
      final grantId = value['grant_id'];
      final installationId = value['installation_id'];
      final sendToken = value['send_token'];
      final expiresAt = value['expires_at'];
      if (grantId is! String ||
          installationId is! String ||
          sendToken is! String ||
          expiresAt is! String) return null;
      final expiry = DateTime.tryParse(expiresAt);
      if (expiry == null || expiry.isBefore(DateTime.now().toUtc()))
        return null;
      return PushTokenGrant(
          grantId: grantId,
          installationId: installationId,
          sendToken: sendToken,
          expiresAt: expiry);
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}

class PushTokenGrant {
  const PushTokenGrant(
      {required this.grantId,
      required this.installationId,
      required this.sendToken,
      required this.expiresAt});
  final String grantId;
  final String installationId;
  final String sendToken;
  final DateTime expiresAt;
}
