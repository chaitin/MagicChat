import 'package:flutter_test/flutter_test.dart';
import 'package:magicchat_client/domain/message_content.dart';

void main() {
  test('结构化消息生成稳定摘要并保留原始字段', () {
    final image = MessageContent.parse({'type': 'image', 'file_id': 'f1'});
    expect(image.type, 'image');
    expect(image.text, '[图片]');
    expect(image.raw['file_id'], 'f1');
    expect(MessageContent.parse({'type': 'chart'}).text, '[图表]');
  });

  test('提及 token 按联系人名称渲染', () {
    expect(
      formatMentionText(
        '你好 {(@user/ABC)} {(@user/all)} {(@app/XYZ)}',
        [(id: 'abc', name: '小明')],
      ),
      '你好 @小明 @所有人 @应用',
    );
  });
}
