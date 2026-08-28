import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:magicchat_client/data/local_notification_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('无原生通知插件时安全降级', () async {
    const channel = MethodChannel('test/magicchat/notifications');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    await const LocalNotificationService(channel: channel)
        .showMessage(conversationId: 'c1', title: '测试', body: '正文');
  });
}
