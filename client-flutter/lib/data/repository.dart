import 'dart:convert';
import 'package:http/http.dart' as http;
import '../domain/models.dart';
import '../domain/message_content.dart';

abstract interface class MagicChatRepository {
  Future<CurrentUser> currentUser();
  Future<CurrentUser> updateProfile({String? nickname, String? avatar});
  Future<CurrentUser> uploadAvatar(AttachmentUpload upload);
  Future<List<ChatConversation>> conversations();
  Future<ChatConversation> createGroupConversation(String name,
      {List<String> memberIds = const [], List<String> appIds = const []});
  Future<ChatConversation> createAppConversation(String appId);
  Future<ChatConversation> createDirectConversation(String userId);
  Future<void> dismissConversation(String conversationId);
  Future<void> renameGroupConversation(String conversationId, String name);
  Future<void> updateGroupAnnouncement(
      String conversationId, String announcement);
  Future<void> setGroupVisibility(String conversationId, bool isPublic);
  Future<void> uploadConversationAvatar(
      String conversationId, AttachmentUpload upload);
  Future<void> addConversationMembers(String conversationId,
      {List<String> memberIds = const [], List<String> appIds = const []});
  Future<void> removeConversationMember(String conversationId, String memberId);
  Future<ChatConversation> createTopic(String conversationId, String messageId);
  Future<void> forwardMessage(
      String conversationId, String messageId, String targetConversationId);
  Future<List<ChatMessage>> messages(String conversationId,
      {int? beforeSeq, int limit = 50});
  Future<void> sendMessage(String conversationId, String text);
  Future<bool> setConversationPinned(String conversationId, bool pinned);
  Future<bool> setConversationMuted(String conversationId, bool muted);
  Future<void> markConversationRead(String conversationId, int upToSeq);
  Future<List<MessageSearchResult>> searchMessages(String keyword);
  Future<void> revokeMessage(String conversationId, String messageId);
  Future<void> sendFile(String conversationId, AttachmentUpload upload);
  Future<Uri?> attachmentUrl(String fileId);
  Future<void> sendImage(String conversationId, AttachmentUpload upload,
      {String caption = ''});
  Future<void> sendVoice(String conversationId, AttachmentUpload upload,
      {String transcript = '', int durationMs = 0});
  Future<List<MessageReaction>> setReaction(
      String conversationId, String messageId,
      {required String text, required bool reacted});
  Future<void> submitChoice(
      String conversationId, String messageId, List<String> optionIds);
  Future<List<Contact>> contacts({String keyword = ''});
  Future<List<Project>> projects();
  Future<Project> createProject(String name, {String description = ''});
  Future<Project> updateProject(String projectId,
      {String? name, String? description});
  Future<void> deleteProject(String projectId);
  Future<List<ProjectTask>> tasks(String projectId);
  Future<List<ProjectDocument>> documents(String projectId);
  Future<ProjectDocument> createDocument(String projectId, String title,
      {String kind = 'document'});
  Future<ProjectDocument> updateDocument(String documentId,
      {String? title, String? parentId});
  Future<void> deleteDocument(String documentId);
  Future<void> moveDocument(String documentId,
      {String? parentId, int index = 0});
  Future<ProjectTask> createTask(String projectId, String title);
  Future<ProjectTask> updateTaskStatus(
      String projectId, String taskId, String status);
  Future<ProjectTask> updateTask(String projectId, String taskId,
      {String? title,
      String? description,
      String? status,
      int? priority,
      String? startDate,
      String? dueDate,
      List<String>? labels,
      String? assigneeUserId,
      Map<String, dynamic>? reminder});
  Future<void> deleteTask(String projectId, String taskId);
  Future<void> addTaskComment(String projectId, String taskId, String content);
}

/// 开发壳数据。接入服务端时实现本接口，UI 不依赖 HTTP/WebSocket 细节。
class DemoRepository implements MagicChatRepository {
  CurrentUser _user =
      const CurrentUser(id: 'demo', name: '演示用户', email: 'demo@example.com');

  @override
  Future<CurrentUser> currentUser() async => _user;

  @override
  Future<CurrentUser> updateProfile({String? nickname, String? avatar}) async {
    _user = CurrentUser(
        id: _user.id,
        name: _user.name,
        email: _user.email,
        nickname: nickname ?? _user.nickname,
        avatar: avatar ?? _user.avatar,
        phone: _user.phone);
    return _user;
  }

  @override
  Future<CurrentUser> uploadAvatar(AttachmentUpload upload) async => _user;

  final _messages = <ChatMessage>[
    const ChatMessage(id: '1', author: '小助手', text: '你好，欢迎使用 MagicChat！'),
    const ChatMessage(
        id: '2', author: '我', text: 'Flutter 客户端正在迁移中。', mine: true),
  ];

  @override
  Future<List<ChatConversation>> conversations() async => const [
        ChatConversation(
            id: 'welcome',
            title: 'MagicChat 小助手',
            preview: 'Flutter 客户端正在迁移中。'),
        ChatConversation(
            id: 'team', title: '团队群聊', preview: '今天的项目进展如何？', unread: 2),
      ];

  @override
  Future<ChatConversation> createGroupConversation(String name,
          {List<String> memberIds = const [],
          List<String> appIds = const []}) async =>
      ChatConversation(id: DateTime.now().toIso8601String(), title: name);

  @override
  Future<ChatConversation> createAppConversation(String appId) async =>
      ChatConversation(id: appId, title: '应用会话');

  @override
  Future<ChatConversation> createDirectConversation(String userId) async =>
      ChatConversation(id: userId, title: '私聊');

  @override
  Future<void> dismissConversation(String conversationId) async {}

  @override
  Future<void> renameGroupConversation(
      String conversationId, String name) async {}

  @override
  Future<void> updateGroupAnnouncement(
      String conversationId, String announcement) async {}

  @override
  Future<void> setGroupVisibility(String conversationId, bool isPublic) async {}

  @override
  Future<void> uploadConversationAvatar(
      String conversationId, AttachmentUpload upload) async {}

  @override
  Future<void> addConversationMembers(String conversationId,
      {List<String> memberIds = const [],
      List<String> appIds = const []}) async {}

  @override
  Future<void> removeConversationMember(
      String conversationId, String memberId) async {}

  @override
  Future<ChatConversation> createTopic(
          String conversationId, String messageId) async =>
      ChatConversation(id: '$conversationId:$messageId', title: '话题');

  @override
  Future<void> forwardMessage(String conversationId, String messageId,
      String targetConversationId) async {}

  @override
  Future<List<ChatMessage>> messages(String conversationId,
          {int? beforeSeq, int limit = 50}) async =>
      List.unmodifiable(_messages);

  @override
  Future<void> sendMessage(String conversationId, String text) async {
    _messages.add(ChatMessage(
        id: DateTime.now().toIso8601String(),
        author: '我',
        text: text,
        mine: true));
  }

  @override
  Future<bool> setConversationPinned(
          String conversationId, bool pinned) async =>
      pinned;
  @override
  Future<bool> setConversationMuted(String conversationId, bool muted) async =>
      muted;
  @override
  Future<void> markConversationRead(String conversationId, int upToSeq) async {}

  @override
  Future<List<MessageSearchResult>> searchMessages(String keyword) async =>
      const [];

  @override
  Future<void> sendFile(String conversationId, AttachmentUpload upload) async {}
  @override
  Future<Uri?> attachmentUrl(String fileId) async => null;
  @override
  Future<void> revokeMessage(String conversationId, String messageId) async {}
  @override
  Future<void> sendImage(String conversationId, AttachmentUpload upload,
      {String caption = ''}) async {}
  @override
  Future<void> sendVoice(String conversationId, AttachmentUpload upload,
      {String transcript = '', int durationMs = 0}) async {}

  @override
  Future<List<MessageReaction>> setReaction(
          String conversationId, String messageId,
          {required String text, required bool reacted}) async =>
      const [];
  @override
  Future<void> submitChoice(
      String conversationId, String messageId, List<String> optionIds) async {}

  @override
  Future<List<Contact>> contacts({String keyword = ''}) async => const [
        Contact(id: '1', name: '小助手', online: true),
        Contact(id: '2', name: '团队成员'),
      ];

  @override
  Future<List<Project>> projects() async => const [
        Project(id: '1', name: 'MagicChat Flutter 重构', taskCount: 12),
        Project(id: '2', name: '产品迭代', taskCount: 5),
      ];

  @override
  Future<Project> createProject(String name, {String description = ''}) async =>
      Project(id: DateTime.now().toIso8601String(), name: name);

  @override
  Future<Project> updateProject(String projectId,
          {String? name, String? description}) async =>
      Project(
          id: projectId, name: name ?? '项目', description: description ?? '');

  @override
  Future<void> deleteProject(String projectId) async {}

  @override
  Future<List<ProjectTask>> tasks(String projectId) async => const [
        ProjectTask(
            id: 'demo-task',
            projectId: '1',
            title: '迁移消息渲染器',
            status: 'in_progress'),
      ];

  @override
  Future<List<ProjectDocument>> documents(String projectId) async => const [];

  @override
  Future<ProjectDocument> createDocument(String projectId, String title,
          {String kind = 'document'}) async =>
      ProjectDocument(
          id: DateTime.now().toIso8601String(),
          projectId: projectId,
          title: title,
          kind: kind);

  @override
  Future<ProjectDocument> updateDocument(String documentId,
          {String? title, String? parentId}) async =>
      ProjectDocument(
          id: documentId,
          projectId: '',
          title: title ?? '文档',
          parentId: parentId);

  @override
  Future<void> deleteDocument(String documentId) async {}

  @override
  Future<void> moveDocument(String documentId,
      {String? parentId, int index = 0}) async {}

  @override
  Future<ProjectTask> createTask(String projectId, String title) async =>
      ProjectTask(
          id: DateTime.now().toIso8601String(),
          projectId: projectId,
          title: title,
          status: 'todo');

  @override
  Future<ProjectTask> updateTaskStatus(
          String projectId, String taskId, String status) async =>
      ProjectTask(
          id: taskId, projectId: projectId, title: '任务', status: status);

  @override
  Future<ProjectTask> updateTask(String projectId, String taskId,
          {String? title,
          String? description,
          String? status,
          int? priority,
          String? startDate,
          String? dueDate,
          List<String>? labels,
          String? assigneeUserId,
          Map<String, dynamic>? reminder}) async =>
      ProjectTask(
          id: taskId,
          projectId: projectId,
          title: title ?? '任务',
          status: status ?? 'todo',
          description: description ?? '',
          priority: priority ?? 2,
          startDate: startDate,
          dueDate: dueDate,
          labels: labels ?? const [],
          assigneeUserId: assigneeUserId);

  @override
  Future<void> deleteTask(String projectId, String taskId) async {}

  @override
  Future<void> addTaskComment(
      String projectId, String taskId, String content) async {}
}

/// 服务端 `/api/client/` 的最小 HTTP 实现。所有响应先按 unknown 解码，再做字段校验。
class HttpMagicChatRepository implements MagicChatRepository {
  static const requestTimeout = Duration(seconds: 30);
  HttpMagicChatRepository(
      {required String serverUrl,
      required this.sessionToken,
      http.Client? client})
      : baseUri =
            Uri.parse(serverUrl.endsWith('/') ? serverUrl : '$serverUrl/'),
        _client = client ?? http.Client();
  final Uri baseUri;
  final String sessionToken;
  final http.Client _client;

  @override
  Future<ChatConversation> createGroupConversation(String name,
      {List<String> memberIds = const [],
      List<String> appIds = const []}) async {
    final data =
        _data(await _request('POST', '/api/client/conversations/groups', body: {
      'name': name,
      'member_ids': memberIds,
      'app_ids': appIds,
    }));
    final value = data['conversation'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('群聊响应格式不正确');
    return _conversationFromJson(value);
  }

  @override
  Future<ChatConversation> createAppConversation(String appId) async {
    final data = _data(await _request('POST', '/api/client/conversations/apps',
        body: {'app_id': appId}));
    final value = data['conversation'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('应用会话响应格式不正确');
    return _conversationFromJson(value);
  }

  @override
  Future<ChatConversation> createDirectConversation(String userId) async {
    final data = _data(await _request(
        'POST', '/api/client/conversations/direct',
        body: {'user_id': userId}));
    final value = data['conversation'];
    if (value is! Map<String, dynamic>) {
      throw const FormatException('私聊响应格式不正确');
    }
    return _conversationFromJson(value);
  }

  @override
  Future<void> dismissConversation(String conversationId) async {
    await _request('DELETE',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}');
  }

  @override
  Future<void> renameGroupConversation(
      String conversationId, String name) async {
    await _request('PATCH',
        '/api/client/conversations/groups/${Uri.encodeComponent(conversationId)}/name',
        body: {'name': name});
  }

  @override
  Future<void> updateGroupAnnouncement(
      String conversationId, String announcement) async {
    await _request('PATCH',
        '/api/client/conversations/groups/${Uri.encodeComponent(conversationId)}/announcement',
        body: {'announcement': announcement});
  }

  @override
  Future<void> setGroupVisibility(String conversationId, bool isPublic) async {
    await _request('POST',
        '/api/client/conversations/groups/${Uri.encodeComponent(conversationId)}/${isPublic ? 'public' : 'private'}');
  }

  @override
  Future<void> uploadConversationAvatar(
      String conversationId, AttachmentUpload upload) async {
    final uri = baseUri.resolve(
        'api/client/conversations/${Uri.encodeComponent(conversationId)}/avatar');
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $sessionToken'
      ..headers['Accept'] = 'application/json'
      ..files.add(upload.bytes != null
          ? http.MultipartFile.fromBytes('file', upload.bytes!,
              filename: upload.name, contentType: _mediaType(upload.mimeType))
          : await http.MultipartFile.fromPath('file', upload.path,
              filename: upload.name, contentType: _mediaType(upload.mimeType)));
    final response = await _client.send(request).timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('群头像上传失败（HTTP ${response.statusCode}）');
    }
  }

  @override
  Future<void> addConversationMembers(String conversationId,
      {List<String> memberIds = const [],
      List<String> appIds = const []}) async {
    await _request('POST',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/members',
        body: {'member_ids': memberIds, 'app_ids': appIds});
  }

  @override
  Future<void> removeConversationMember(
      String conversationId, String memberId) async {
    await _request('DELETE',
        '/api/client/conversations/groups/${Uri.encodeComponent(conversationId)}/members/${Uri.encodeComponent(memberId)}');
  }

  @override
  Future<ChatConversation> createTopic(
      String conversationId, String messageId) async {
    final data = _data(await _request('POST',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/${Uri.encodeComponent(messageId)}/topic'));
    final value = data['conversation'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('话题响应格式不正确');
    return _conversationFromJson(value);
  }

  @override
  Future<void> forwardMessage(String conversationId, String messageId,
      String targetConversationId) async {
    await _request('POST',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/forward',
        body: {
          'client_forward_id': DateTime.now().microsecondsSinceEpoch.toString(),
          'message_ids': [messageId],
          'mode': 'single',
          'target_conversation_ids': [targetConversationId],
        });
  }

  ChatConversation _conversationFromJson(Map<String, dynamic> item) =>
      ChatConversation(
          id: '${item['id'] ?? ''}',
          title: '${item['name'] ?? '未命名会话'}',
          preview: '${item['summary'] ?? ''}',
          announcement: '${item['announcement'] ?? ''}',
          isPublic: item['visibility'] == 'public' || item['is_public'] == true,
          avatar: '${item['avatar'] ?? ''}',
          unread: (item['unread_count'] as num?)?.toInt() ?? 0,
          pinned: item['pinned'] == true,
          muted: item['notification_muted'] == true,
          lastMessageSeq: (item['last_message_seq'] as num?)?.toInt() ?? 0,
          members: _membersFromJson(item['members']));

  List<Contact> _membersFromJson(Object? value) => value is List
      ? value
          .whereType<Map<String, dynamic>>()
          .where((item) => item['id'] is String && item['name'] is String)
          .map((item) => Contact(
              id: item['id'] as String,
              name: item['name'] as String,
              online: item['online'] == true))
          .toList()
      : const [];

  @override
  Future<CurrentUser> currentUser() async {
    final data = _data(await _request('GET', '/api/client/me'));
    final value = data['user'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('用户信息响应格式不正确');
    return _userFromJson(value);
  }

  @override
  Future<CurrentUser> updateProfile({String? nickname, String? avatar}) async {
    final body = <String, dynamic>{};
    if (nickname != null) body['nickname'] = nickname;
    if (avatar != null) body['avatar'] = avatar;
    final data = _data(await _request('PATCH', '/api/client/me', body: body));
    final value = data['user'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('用户信息响应格式不正确');
    return _userFromJson(value);
  }

  @override
  Future<CurrentUser> uploadAvatar(AttachmentUpload upload) async {
    final uri = baseUri.resolve('api/client/me/avatar');
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $sessionToken'
      ..headers['Accept'] = 'application/json'
      ..files.add(upload.bytes != null
          ? http.MultipartFile.fromBytes('file', upload.bytes!,
              filename: upload.name, contentType: _mediaType(upload.mimeType))
          : await http.MultipartFile.fromPath('file', upload.path,
              filename: upload.name, contentType: _mediaType(upload.mimeType)));
    final response = await _client.send(request).timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('头像上传失败（HTTP ${response.statusCode}）');
    }
    final text = await response.stream.bytesToString();
    final value = _data(jsonDecode(text))['user'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('用户信息响应格式不正确');
    return _userFromJson(value);
  }

  CurrentUser _userFromJson(Map<String, dynamic> value) => CurrentUser(
      id: '${value['id'] ?? ''}',
      name: '${value['name'] ?? ''}',
      email: '${value['email'] ?? ''}',
      nickname: '${value['nickname'] ?? ''}',
      avatar: '${value['avatar'] ?? ''}',
      phone: '${value['phone'] ?? ''}');

  Future<dynamic> _request(String method, String path, {Object? body}) async {
    final uri = baseUri.resolve(path.replaceFirst(RegExp(r'^/'), ''));
    final headers = <String, String>{
      'Accept': 'application/json',
      'Authorization': 'Bearer $sessionToken'
    };
    if (body != null) headers['Content-Type'] = 'application/json';
    final response = await _client
        .send(http.Request(method, uri)
          ..headers.addAll(headers)
          ..body = body == null ? '' : jsonEncode(body))
        .timeout(requestTimeout);
    final text = await response.stream.bytesToString();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('请求失败（HTTP ${response.statusCode}）');
    }
    if (text.isEmpty) return null;
    return jsonDecode(text);
  }

  Map<String, dynamic> _data(dynamic value) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('服务端响应格式不正确');
    }
    final data = value['data'];
    return data is Map<String, dynamic> ? data : value;
  }

  @override
  Future<List<ChatConversation>> conversations() async {
    final data = _data(await _request('GET', '/api/client/conversations'));
    final values = data['conversations'];
    if (values is! List) throw const FormatException('会话列表响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map(_conversationFromJson)
        .where((item) => item.id.isNotEmpty)
        .toList();
  }

  @override
  Future<List<ChatMessage>> messages(String conversationId,
      {int? beforeSeq, int limit = 50}) async {
    final query = <String, String>{'limit': '$limit'};
    if (beforeSeq != null) query['before_seq'] = '$beforeSeq';
    final suffix = Uri(queryParameters: query).query;
    final data = _data(await _request('GET',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages?$suffix'));
    final values = data['messages'];
    if (values is! List) throw const FormatException('消息列表响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final content = MessageContent.parse(item['body']);
          final sender = item['sender'];
          final senderName =
              sender is Map<String, dynamic> ? sender['name'] : null;
          return ChatMessage(
              id: '${item['id'] ?? ''}',
              sequence: (item['seq'] as num?)?.toInt(),
              author: '${senderName ?? '用户'}',
              conversationId: conversationId,
              contentType: content.type,
              rawBody: content.raw,
              text: content.text);
        })
        .where((item) => item.id.isNotEmpty)
        .toList();
  }

  @override
  Future<void> sendMessage(String conversationId, String text) async =>
      _request('POST',
          '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages',
          body: {
            'client_message_id':
                DateTime.now().microsecondsSinceEpoch.toString(),
            'body': {'type': 'text', 'content': text}
          });

  @override
  Future<bool> setConversationPinned(String conversationId, bool pinned) async {
    final value = await _request(pinned ? 'PUT' : 'DELETE',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/pin');
    return _data(value)['pinned'] == true;
  }

  @override
  Future<bool> setConversationMuted(String conversationId, bool muted) async {
    final value = await _request(muted ? 'PUT' : 'DELETE',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/mute');
    return _data(value)['muted'] == true;
  }

  @override
  Future<void> markConversationRead(String conversationId, int upToSeq) async {
    await _request('POST',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/read',
        body: {'up_to_seq': upToSeq});
  }

  @override
  Future<List<MessageSearchResult>> searchMessages(String keyword) async {
    final encoded = Uri(queryParameters: {'keyword': keyword}).query;
    final data =
        _data(await _request('GET', '/api/client/search/messages?$encoded'));
    final values = data['items'];
    if (values is! List) throw const FormatException('搜索响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final conversation = item['conversation'];
          final message = item['message'];
          if (conversation is! Map<String, dynamic> ||
              message is! Map<String, dynamic>) {
            return null;
          }
          final body = MessageContent.parse(message['body']);
          final sender = message['sender'];
          final name = sender is Map<String, dynamic> ? sender['name'] : null;
          final conversationId = conversation['id'];
          final conversationName = conversation['name'];
          final chat = ChatMessage(
              id: '${message['id'] ?? ''}',
              author: name is String ? name : '用户',
              conversationId: conversationId is String ? conversationId : null,
              contentType: body.type,
              rawBody: body.raw,
              text: body.text);
          return conversationId is String && conversationName is String
              ? MessageSearchResult(
                  conversationId: conversationId,
                  conversationName: conversationName,
                  message: chat)
              : null;
        })
        .whereType<MessageSearchResult>()
        .toList();
  }

  @override
  Future<void> revokeMessage(String conversationId, String messageId) async {
    await _request('POST',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/${Uri.encodeComponent(messageId)}/revoke');
  }

  @override
  Future<void> sendFile(String conversationId, AttachmentUpload upload) async {
    await _sendMultipart(conversationId, 'files', 'file', upload, const {});
  }

  @override
  Future<Uri?> attachmentUrl(String fileId) async {
    final data = _data(
        await _request('POST', '/api/client/temporary-files/read-urls', body: {
      'file_ids': [fileId]
    }));
    final urls = data['urls'];
    if (urls is! List || urls.isEmpty) return null;
    final value = urls.first;
    final url = value is Map<String, dynamic> ? value['url'] : null;
    return url is String && Uri.tryParse(url) != null ? Uri.parse(url) : null;
  }

  @override
  Future<void> sendImage(String conversationId, AttachmentUpload upload,
          {String caption = ''}) async =>
      _sendMultipart(conversationId, 'images', 'image', upload,
          {'caption': caption, 'caption_type': 'text'});

  @override
  Future<void> sendVoice(String conversationId, AttachmentUpload upload,
          {String transcript = '', int durationMs = 0}) async =>
      _sendMultipart(conversationId, 'voices', 'voice', upload,
          {'transcript': transcript, 'duration_ms': '$durationMs'});

  Future<void> _sendMultipart(String conversationId, String route, String field,
      AttachmentUpload upload, Map<String, String> fields) async {
    final uri = baseUri.resolve(
        'api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/$route');
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $sessionToken'
      ..headers['Accept'] = 'application/json'
      ..fields['client_message_id'] =
          DateTime.now().microsecondsSinceEpoch.toString()
      ..fields.addAll(fields)
      ..files.add(upload.bytes != null
          ? http.MultipartFile.fromBytes(field, upload.bytes!,
              filename: upload.name, contentType: _mediaType(upload.mimeType))
          : await http.MultipartFile.fromPath(field, upload.path,
              filename: upload.name, contentType: _mediaType(upload.mimeType)));
    final response = await _client.send(request).timeout(requestTimeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('附件发送失败（HTTP ${response.statusCode}）');
    }
  }

  http.MediaType _mediaType(String value) {
    final parts = value.split('/');
    return parts.length == 2
        ? http.MediaType(parts[0], parts[1])
        : http.MediaType('application', 'octet-stream');
  }

  @override
  Future<List<MessageReaction>> setReaction(
      String conversationId, String messageId,
      {required String text, required bool reacted}) async {
    final data = _data(await _request('PUT',
        '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/${Uri.encodeComponent(messageId)}/reactions',
        body: {'text': text, 'reacted': reacted}));
    final values = data['reactions'];
    if (values is! List) throw const FormatException('表情响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map((item) => MessageReaction(
            text: '${item['text'] ?? ''}',
            count: (item['count'] as num?)?.toInt() ?? 0,
            reactedByMe: item['reacted_by_me'] == true))
        .toList();
  }

  @override
  Future<void> submitChoice(String conversationId, String messageId,
          List<String> optionIds) async =>
      _request('PUT',
          '/api/client/conversations/${Uri.encodeComponent(conversationId)}/messages/${Uri.encodeComponent(messageId)}/choice-response',
          body: {'option_ids': optionIds.toSet().toList()});

  @override
  Future<List<Contact>> contacts({String keyword = ''}) async {
    final query = keyword.trim().isEmpty
        ? ''
        : '?${Uri(queryParameters: {'keyword': keyword.trim()}).query}';
    final data = _data(await _request('GET', '/api/client/contacts$query'));
    final result = <Contact>[];
    final apps = data['apps'];
    final groups = data['groups'];
    if (apps is! List || groups is! List) {
      throw const FormatException('通讯录响应格式不正确');
    }
    for (final value in [...apps, ...groups]) {
      if (value is! Map<String, dynamic> ||
          value['id'] is! String ||
          value['name'] is! String) {
        continue;
      }
      result.add(Contact(
          id: value['id'] as String,
          name: value['name'] as String,
          online: value['online'] == true,
          type:
              '${value['type'] ?? (apps.contains(value) ? 'app' : 'group')}'));
    }
    final userIds = data['user_ids'];
    if (userIds is List) {
      final ids =
          userIds.whereType<String>().where((id) => id.isNotEmpty).toList();
      if (ids.isNotEmpty) {
        final resolved = _data(await _request(
            'POST', '/api/client/users/resolve',
            body: {'user_ids': ids.take(100).toList()}))['users'];
        if (resolved is List) {
          for (final value in resolved) {
            if (value is Map<String, dynamic> &&
                value['id'] is String &&
                value['name'] is String) {
              result.add(Contact(
                  id: value['id'] as String,
                  name: value['name'] as String,
                  online: value['online'] == true,
                  type: 'user'));
            }
          }
        }
      }
    }
    return result;
  }

  @override
  Future<List<Project>> projects() async {
    final data = _data(await _request('GET', '/api/client/projects?limit=100'));
    final result = <Project>[];
    final personal = data['personal_project'];
    final projects = data['projects'];
    for (final value in [personal, if (projects is List) ...projects]) {
      if (value is Map<String, dynamic> &&
          value['id'] is String &&
          value['name'] is String) {
        result.add(
            Project(id: value['id'] as String, name: value['name'] as String));
      }
    }
    return result;
  }

  @override
  Future<Project> createProject(String name, {String description = ''}) async {
    final data = _data(await _request('POST', '/api/client/projects', body: {
      'name': name,
      'description': description,
    }));
    final value = data['project'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('项目响应格式不正确');
    return Project(
        id: '${value['id'] ?? ''}', name: '${value['name'] ?? name}');
  }

  @override
  Future<Project> updateProject(String projectId,
      {String? name, String? description}) async {
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (description != null) body['description'] = description;
    final data = _data(await _request(
        'PATCH', '/api/client/projects/${Uri.encodeComponent(projectId)}',
        body: body));
    final value = data['project'];
    if (value is! Map<String, dynamic>) {
      throw const FormatException('项目响应格式不正确');
    }
    return Project(
        id: '${value['id'] ?? projectId}',
        name: '${value['name'] ?? name ?? ''}',
        description: '${value['description'] ?? description ?? ''}');
  }

  @override
  Future<void> deleteProject(String projectId) async {
    await _request(
        'DELETE', '/api/client/projects/${Uri.encodeComponent(projectId)}');
  }

  @override
  Future<List<ProjectTask>> tasks(String projectId) async {
    final data = _data(await _request('GET',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks?limit=100'));
    final values = data['tasks'];
    if (values is! List) throw const FormatException('任务列表响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map((item) => ProjectTask(
            id: '${item['id'] ?? ''}',
            projectId: '${item['project_id'] ?? projectId}',
            title: '${item['title'] ?? ''}',
            status: '${item['status'] ?? 'todo'}',
            description: '${item['description'] ?? ''}',
            priority: (item['priority'] as num?)?.toInt() ?? 2,
            startDate: item['start_date'] as String?,
            dueDate: item['due_date'] as String?,
            labels: _labels(item['labels']),
            assigneeUserId: item['assignee_user_id'] as String?,
            reminder: item['reminder'] is Map<String, dynamic>
                ? item['reminder'] as Map<String, dynamic>
                : null))
        .where((task) => task.id.isNotEmpty && task.title.isNotEmpty)
        .toList();
  }

  @override
  Future<List<ProjectDocument>> documents(String projectId) async {
    final data = _data(await _request('GET',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/documents'));
    final values = data['documents'];
    if (values is! List) throw const FormatException('文档列表响应格式不正确');
    return values
        .whereType<Map<String, dynamic>>()
        .map((item) => ProjectDocument(
              id: '${item['id'] ?? ''}',
              projectId: '${item['project_id'] ?? projectId}',
              title: '${item['title'] ?? ''}',
              kind: '${item['kind'] ?? 'document'}',
              parentId: item['parent_id'] as String?,
            ))
        .where((item) => item.id.isNotEmpty && item.title.isNotEmpty)
        .toList();
  }

  @override
  Future<ProjectDocument> createDocument(String projectId, String title,
      {String kind = 'document'}) async {
    final data = _data(await _request('POST',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/documents',
        body: {
          'kind': kind,
          'title': title,
        }));
    final value = data['document'];
    if (value is! Map<String, dynamic>)
      throw const FormatException('文档响应格式不正确');
    return ProjectDocument(
        id: '${value['id'] ?? ''}',
        projectId: projectId,
        title: '${value['title'] ?? title}',
        kind: '${value['kind'] ?? kind}',
        parentId: value['parent_id'] as String?);
  }

  @override
  Future<ProjectDocument> updateDocument(String documentId,
      {String? title, String? parentId}) async {
    final body = <String, dynamic>{};
    if (title != null) body['title'] = title;
    if (parentId != null) body['parent_id'] = parentId;
    final data = _data(await _request(
        'PATCH', '/api/client/documents/${Uri.encodeComponent(documentId)}',
        body: body));
    final value = data['document'];
    if (value is! Map<String, dynamic>) {
      throw const FormatException('文档响应格式不正确');
    }
    return ProjectDocument(
        id: '${value['id'] ?? documentId}',
        projectId: '${value['project_id'] ?? ''}',
        title: '${value['title'] ?? title ?? ''}',
        kind: '${value['kind'] ?? 'document'}',
        parentId: value['parent_id'] as String?);
  }

  @override
  Future<void> deleteDocument(String documentId) async {
    await _request(
        'DELETE', '/api/client/documents/${Uri.encodeComponent(documentId)}');
  }

  @override
  Future<void> moveDocument(String documentId,
      {String? parentId, int index = 0}) async {
    await _request(
        'POST', '/api/client/documents/${Uri.encodeComponent(documentId)}/move',
        body: {
          'parent_id': parentId,
          'index': index,
        });
  }

  @override
  Future<ProjectTask> createTask(String projectId, String title) async {
    final data = _data(await _request(
        'POST', '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks',
        body: {'title': title}));
    return _taskFromJson(data);
  }

  @override
  Future<ProjectTask> updateTaskStatus(
      String projectId, String taskId, String status) async {
    final data = _data(await _request('PATCH',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks/${Uri.encodeComponent(taskId)}',
        body: {'status': status}));
    return _taskFromJson(data);
  }

  @override
  Future<ProjectTask> updateTask(String projectId, String taskId,
      {String? title,
      String? description,
      String? status,
      int? priority,
      String? startDate,
      String? dueDate,
      List<String>? labels,
      String? assigneeUserId,
      Map<String, dynamic>? reminder}) async {
    final body = <String, dynamic>{};
    if (title != null) body['title'] = title;
    if (description != null) body['description'] = description;
    if (status != null) body['status'] = status;
    if (priority != null) body['priority'] = priority;
    if (startDate != null) body['start_date'] = startDate;
    if (dueDate != null) body['due_date'] = dueDate;
    if (labels != null) body['labels'] = labels;
    if (assigneeUserId != null) body['assignee_user_id'] = assigneeUserId;
    if (reminder != null) body['reminder'] = reminder;
    final data = _data(await _request('PATCH',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks/${Uri.encodeComponent(taskId)}',
        body: body));
    return _taskFromJson(data);
  }

  @override
  Future<void> deleteTask(String projectId, String taskId) async {
    await _request('DELETE',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks/${Uri.encodeComponent(taskId)}');
  }

  @override
  Future<void> addTaskComment(
      String projectId, String taskId, String content) async {
    await _request('POST',
        '/api/client/projects/${Uri.encodeComponent(projectId)}/tasks/${Uri.encodeComponent(taskId)}/comments',
        body: {'content': content});
  }

  ProjectTask _taskFromJson(Map<String, dynamic> item) => ProjectTask(
      id: '${item['id'] ?? ''}',
      projectId: '${item['project_id'] ?? ''}',
      title: '${item['title'] ?? ''}',
      status: '${item['status'] ?? 'todo'}',
      description: '${item['description'] ?? ''}',
      priority: (item['priority'] as num?)?.toInt() ?? 2,
      startDate: item['start_date'] as String?,
      dueDate: item['due_date'] as String?,
      labels: _labels(item['labels']),
      assigneeUserId: item['assignee_user_id'] as String?,
      reminder: item['reminder'] is Map<String, dynamic>
          ? item['reminder'] as Map<String, dynamic>
          : null);

  List<String> _labels(Object? value) => value is List
      ? value
          .whereType<String>()
          .where((item) => item.trim().isNotEmpty)
          .toList()
      : const [];
}
