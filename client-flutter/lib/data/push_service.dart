import 'dart:convert';
import 'package:http/http.dart' as http;
import 'push_token_provider.dart';

class PushGrant {
  const PushGrant(
      {required this.grantId,
      required this.installationId,
      required this.sendToken,
      required this.expiresAt});
  final String grantId;
  final String installationId;
  final String sendToken;
  final DateTime expiresAt;
}

/// 私有 Server 推送授权生命周期。设备厂商 Token 由各平台插件提供，不写入普通配置。
class PushService {
  static const requestTimeout = Duration(seconds: 30);
  PushService({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;

  Future<bool> registerPlatformGrant({
    required String serverUrl,
    required String sessionToken,
    required String platform,
    PushTokenProvider provider = const PushTokenProvider(),
  }) async {
    final grant = await provider.readGrant();
    if (grant == null) return false;
    await registerGrant(
        serverUrl: serverUrl,
        sessionToken: sessionToken,
        platform: platform,
        grant: PushGrant(
            grantId: grant.grantId,
            installationId: grant.installationId,
            sendToken: grant.sendToken,
            expiresAt: grant.expiresAt));
    return true;
  }

  Future<void> registerGrant(
      {required String serverUrl,
      required String sessionToken,
      required PushGrant grant,
      required String platform}) async {
    final base = Uri.parse(serverUrl.endsWith('/') ? serverUrl : '$serverUrl/');
    final response = await _client
        .put(base.resolve('api/client/push/grants'),
            headers: {
              'Authorization': 'Bearer $sessionToken',
              'Content-Type': 'application/json'
            },
            body: jsonEncode({
              'expires_at': grant.expiresAt.toUtc().toIso8601String(),
              'grant_id': grant.grantId,
              'installation_id': grant.installationId,
              'platform': platform,
              'send_token': grant.sendToken
            }))
        .timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('注册推送失败（HTTP ${response.statusCode}）');
    }
  }

  Future<void> revokeGrant(
      {required String serverUrl,
      required String sessionToken,
      required String installationId}) async {
    final base = Uri.parse(serverUrl.endsWith('/') ? serverUrl : '$serverUrl/');
    final response = await _client.delete(
        base.resolve(
            'api/client/push/grants/${Uri.encodeComponent(installationId)}'),
        headers: {
          'Authorization': 'Bearer $sessionToken'
        }).timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('撤销推送失败（HTTP ${response.statusCode}）');
    }
  }

  Future<({String conversationId, String messageId})> resolveRoute(
      {required String serverUrl,
      required String sessionToken,
      required String routeToken}) async {
    final base = Uri.parse(serverUrl.endsWith('/') ? serverUrl : '$serverUrl/');
    final response = await _client.get(
        base.resolve(
            'api/client/push/routes/${Uri.encodeComponent(routeToken)}'),
        headers: {
          'Authorization': 'Bearer $sessionToken'
        }).timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('打开通知失败（HTTP ${response.statusCode}）');
    }
    final value = jsonDecode(response.body);
    if (value is! Map<String, dynamic> ||
        value['conversation_id'] is! String ||
        value['message_id'] is! String) {
      throw const FormatException('通知路由响应格式不正确');
    }
    return (
      conversationId: value['conversation_id'] as String,
      messageId: value['message_id'] as String
    );
  }
}
