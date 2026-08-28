import 'dart:typed_data';

class ChatConversation {
  const ChatConversation(
      {required this.id,
      required this.title,
      this.preview = '',
      this.announcement = '',
      this.isPublic = false,
      this.avatar = '',
      this.unread = 0,
      this.pinned = false,
      this.muted = false,
      this.lastMessageSeq = 0,
      this.members = const []});
  final String id;
  final String title;
  final String preview;
  final String announcement;
  final bool isPublic;
  final String avatar;
  final int unread;
  final bool pinned;
  final bool muted;
  final int lastMessageSeq;
  final List<Contact> members;
}

class ChatMessage {
  const ChatMessage(
      {required this.id,
      required this.text,
      required this.author,
      this.conversationId,
      this.sequence,
      this.contentType = 'text',
      this.rawBody = const {},
      this.mine = false});
  final String id;
  final String? conversationId;
  final int? sequence;
  final String contentType;
  final Map<String, dynamic> rawBody;
  final String text;
  final String author;
  final bool mine;
}

class MessageSearchResult {
  const MessageSearchResult(
      {required this.conversationId,
      required this.conversationName,
      required this.message});
  final String conversationId;
  final String conversationName;
  final ChatMessage message;
}

class AttachmentUpload {
  const AttachmentUpload(
      {required this.path,
      required this.name,
      required this.mimeType,
      this.bytes});
  final String path;
  final String name;
  final String mimeType;
  final Uint8List? bytes;
}

class MessageReaction {
  const MessageReaction(
      {required this.text, required this.count, required this.reactedByMe});
  final String text;
  final int count;
  final bool reactedByMe;
}

class Contact {
  const Contact(
      {required this.id,
      required this.name,
      this.online = false,
      this.type = 'user',
      this.role = 'member'});
  final String id;
  final String name;
  final bool online;
  final String type;
  final String role;
}

class Project {
  const Project(
      {required this.id,
      required this.name,
      this.taskCount = 0,
      this.description = ''});
  final String id;
  final String name;
  final int taskCount;
  final String description;
}

class ProjectTask {
  const ProjectTask(
      {required this.id,
      required this.projectId,
      required this.title,
      required this.status,
      this.priority = 2,
      this.description = '',
      this.startDate,
      this.dueDate,
      this.labels = const [],
      this.assigneeUserId,
      this.reminder});
  final String id;
  final String projectId;
  final String title;
  final String status;
  final int priority;
  final String description;
  final String? startDate;
  final String? dueDate;
  final List<String> labels;
  final String? assigneeUserId;
  final Map<String, dynamic>? reminder;
}

class ProjectDocument {
  const ProjectDocument(
      {required this.id,
      required this.projectId,
      required this.title,
      this.kind = 'document',
      this.parentId});
  final String id;
  final String projectId;
  final String title;
  final String kind;
  final String? parentId;
}

class CurrentUser {
  const CurrentUser(
      {required this.id,
      required this.name,
      required this.email,
      this.nickname = '',
      this.avatar = '',
      this.phone = ''});
  final String id;
  final String name;
  final String email;
  final String nickname;
  final String avatar;
  final String phone;
  String get displayName => nickname.isNotEmpty ? nickname : name;
}
