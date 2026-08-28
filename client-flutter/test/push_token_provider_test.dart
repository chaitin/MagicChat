import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:magicchat_client/data/push_token_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('无原生插件时 Push Grant 安全降级', () async {
    final channel = MethodChannel('test/push');
    channel.setMockMethodCallHandler((_) async => null);
    addTearDown(() => channel.setMockMethodCallHandler(null));
    expect(
        await const PushTokenProvider(channel: MethodChannel('test/push'))
            .readGrant(),
        isNull);
  });

  test('拒绝已过期的原生令牌', () async {
    final channel = MethodChannel('test/push-expired');
    channel.setMockMethodCallHandler((_) async => {
          'grant_id': 'grant',
          'installation_id': 'install',
          'send_token': 'token',
          'expires_at': DateTime.now()
              .toUtc()
              .subtract(const Duration(minutes: 1))
              .toIso8601String(),
        });
    addTearDown(() => channel.setMockMethodCallHandler(null));
    expect(
        await const PushTokenProvider(
                channel: MethodChannel('test/push-expired'))
            .readGrant(),
        isNull);
  });
}
