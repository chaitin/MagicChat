import 'package:flutter_test/flutter_test.dart';
import 'package:magicchat_client/data/realtime_store.dart';
import 'package:magicchat_client/domain/models.dart';

void main() {
  test('按 cursor 忽略重复事件并投影消息', () {
    final store = RealtimeStore();
    store.apply({
      'event': 'message.created',
      'cursor': 2,
      'payload': {
        'id': 'm1',
        'body': {'type': 'text', 'content': '你好'}
      }
    });
    store.apply({
      'event': 'message.created',
      'cursor': 1,
      'payload': {
        'id': 'm2',
        'body': {'type': 'text', 'content': '旧事件'}
      }
    });
    expect(store.cursor, 2);
    expect(store.messages['m1']?.text, '你好');
    expect(store.messages.containsKey('m2'), isFalse);
  });

  test('投影会话置顶和免打扰事件', () {
    final store = RealtimeStore();
    store.conversations['c1'] = const ChatConversation(id: 'c1', title: '会话');
    store.apply({
      'event': 'conversation.pin_updated',
      'cursor': 1,
      'payload': {'conversation_id': 'c1', 'pinned': true}
    });
    expect(store.conversations['c1']?.pinned, isTrue);
    store.apply({
      'event': 'conversation.mute_updated',
      'cursor': 2,
      'payload': {'conversation_id': 'c1', 'muted': true}
    });
    expect(store.conversations['c1']?.muted, isTrue);
  });

  test('投影用户在线状态事件', () {
    final store = RealtimeStore();
    store.contacts['u1'] =
        const Contact(id: 'u1', name: 'Alice', online: false);
    store.apply({
      'event': 'user.presence.updated',
      'cursor': 1,
      'payload': {'user_id': 'u1', 'online': true}
    });
    expect(store.contacts['u1']?.online, isTrue);
  });
}
