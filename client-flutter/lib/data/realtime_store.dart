import 'package:flutter/foundation.dart';
import '../domain/message_content.dart';
import '../domain/models.dart';

/// 将 WebSocket envelope 投影为可观察状态；以消息 ID/cursor 去重，允许重复和乱序事件。
class RealtimeStore extends ChangeNotifier {
  final conversations = <String, ChatConversation>{};
  final messages = <String, ChatMessage>{};
  final contacts = <String, Contact>{};
  String? currentUserId;
  int cursor = 0;

  void setCurrentUserId(String? id) {
    currentUserId = id;
  }

  void apply(Map<String, dynamic> envelope) {
    final value = envelope['cursor'];
    if (value is num && value.toInt() <= cursor) return;
    if (value is num) cursor = value.toInt();
    final event = envelope['event'];
    final payload = envelope['payload'];
    if (payload is! Map<String, dynamic> || event is! String) return;
    switch (event) {
      case 'message.created':
      case 'message.updated':
        _upsertMessage(payload);
      case 'message.reactions_updated':
        _patchReactions(payload);
      case 'conversation.removed':
        final id = payload['conversation_id'];
        if (id is String) conversations.remove(id);
      case 'conversation.pin_updated':
      case 'conversation.mute_updated':
        _patchConversation(payload);
      case 'user.presence.updated':
        _patchPresence(payload);
    }
    notifyListeners();
  }

  void _patchPresence(Map<String, dynamic> payload) {
    final id = payload['user_id'];
    final online = payload['online'];
    if (id is! String || online is! bool) return;
    final current = contacts[id];
    if (current != null) {
      contacts[id] = Contact(
          id: current.id,
          name: current.name,
          online: online,
          type: current.type,
          role: current.role);
    }
  }

  void _patchReactions(Map<String, dynamic> payload) {
    final id = payload['message_id'];
    if (id is! String) return;
    final current = messages[id];
    if (current == null) return;
    final actorText = payload['actor_text'];
    final actorReacted = payload['actor_reacted'] == true;
    final actorUserId = payload['actor_user_id'];
    final reactions = payload['reactions'];
    if (reactions is! List) return;
    messages[id] = ChatMessage(
        id: current.id,
        text: current.text,
        author: current.author,
        conversationId: current.conversationId,
        sequence: current.sequence,
        contentType: current.contentType,
        rawBody: current.rawBody,
        mine: current.mine,
        reactions: reactions
            .whereType<Map<String, dynamic>>()
            .where((item) => item['text'] is String)
            .map((item) => MessageReaction(
                text: item['text'] as String,
                count: (item['count'] as num?)?.toInt() ?? 0,
                reactedByMe: actorUserId == currentUserId &&
                    actorReacted &&
                    actorText == item['text']))
            .where((reaction) => reaction.count > 0)
            .toList());
  }

  void _upsertMessage(Map<String, dynamic> payload) {
    final nested = payload['message'];
    if (nested is Map<String, dynamic>) payload = nested;
    final id = payload['id'];
    if (id is! String || id.isEmpty) return;
    final body = MessageContent.parse(payload['body']);
    final sender = payload['sender'];
    final name = sender is Map<String, dynamic> ? sender['name'] : null;
    final senderId = sender is Map<String, dynamic> ? sender['id'] : null;
    final conversationId = payload['conversation_id'];
    messages[id] = ChatMessage(
        id: id,
        sequence: (payload['seq'] as num?)?.toInt(),
        conversationId: conversationId is String ? conversationId : null,
        author: name is String ? name : '用户',
        contentType: body.type,
        rawBody: body.raw,
        text: body.text,
        mine: senderId is String && senderId == currentUserId,
        reactions: _reactions(payload['reactions']));
  }

  List<MessageReaction> _reactions(Object? value) => value is List
      ? value
          .whereType<Map<String, dynamic>>()
          .where((item) => item['text'] is String)
          .map((item) => MessageReaction(
              text: item['text'] as String,
              count: (item['count'] as num?)?.toInt() ?? 0,
              reactedByMe: item['reacted_by_me'] == true))
          .where((reaction) => reaction.count > 0)
          .toList()
      : const [];

  void _patchConversation(Map<String, dynamic> payload) {
    final id = payload['conversation_id'];
    if (id is! String) return;
    final current = conversations[id];
    if (current == null) return;
    conversations[id] = ChatConversation(
        id: current.id,
        title: current.title,
        preview: current.preview,
        announcement: current.announcement,
        isPublic: current.isPublic,
        avatar: current.avatar,
        unread: current.unread,
        pinned: payload['pinned'] is bool
            ? payload['pinned'] as bool
            : current.pinned,
        muted:
            payload['muted'] is bool ? payload['muted'] as bool : current.muted,
        lastMessageSeq: (payload['last_message_seq'] as num?)?.toInt() ??
            current.lastMessageSeq,
        members: current.members);
  }
}
