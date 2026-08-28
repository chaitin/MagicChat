import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:magicchat_client/main.dart';
import 'package:magicchat_client/data/repository.dart';

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
}
