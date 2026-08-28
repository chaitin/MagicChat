/// 服务端消息 body 的统一解析结果，未知类型保留原始 JSON 以便向前兼容。
class MessageContent {
  const MessageContent(
      {required this.type, required this.text, this.raw = const {}});
  final String type;
  final String text;
  final Map<String, dynamic> raw;

  factory MessageContent.parse(Object? value) {
    if (value is! Map<String, dynamic>) {
      return MessageContent(type: 'unknown', text: '$value');
    }
    final type = value['type'];
    final content = value['content'];
    final text = content is String ? content : _summary(type, value);
    return MessageContent(
        type: type is String ? type : 'unknown',
        text: text,
        raw: Map.unmodifiable(value));
  }

  static String _summary(Object? type, Map<String, dynamic> body) {
    switch (type) {
      case 'image':
        return '[图片]';
      case 'file':
        return '[文件] ${body['name'] ?? ''}'.trim();
      case 'voice':
        return '[语音]';
      case 'choice':
        return '${body['title'] ?? '[选择题]'}';
      case 'object':
        return '[对象]';
      case 'chart':
        return '[图表]';
      default:
        return '[消息]';
    }
  }
}
