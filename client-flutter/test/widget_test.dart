import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:magicchat_client/main.dart';
import 'package:magicchat_client/data/repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('显示跨端导航入口', (tester) async {
    await tester
        .pumpWidget(MaterialApp(home: AppShell(repository: DemoRepository())));
    await tester.pump();
    expect(find.text('MagicChat'), findsOneWidget);
    expect(find.text('消息'), findsOneWidget);
    expect(find.text('联系人'), findsOneWidget);
    expect(find.text('项目'), findsOneWidget);
  });

  testWidgets('会话草稿按会话恢复', (tester) async {
    SharedPreferences.setMockInitialValues({});
    Widget page() => MaterialApp(
        home: Scaffold(
            body: ConversationView(
                repository: DemoRepository(),
                conversationId: 'conversation-1')));
    await tester.pumpWidget(page());
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '稍后发送');
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(page());
    await tester.pumpAndSettle();
    expect(find.text('稍后发送'), findsOneWidget);
  });
}
