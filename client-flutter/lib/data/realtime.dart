import 'dart:convert';
import 'dart:async';
import 'package:web_socket_channel/web_socket_channel.dart';

/// 对齐现有 `/api/client/ws` envelope/cursor 语义，页面可订阅增量事件。
class MagicChatRealtime {
  MagicChatRealtime(
      {required String serverUrl,
      required this.sessionToken,
      required this.connector})
      : _uri = _buildUri(serverUrl);
  final Uri _uri;
  final String sessionToken;

  /// 平台适配层负责以 Authorization header 建立连接（Web 与 IO 实现不同）。
  final WebSocketConnector connector;
  WebSocketChannel? _channel;

  Stream<Map<String, dynamic>> connect({int? cursor}) {
    final query = <String, String>{};
    if (cursor != null) query['cursor'] = '$cursor';
    final uri = _uri.replace(queryParameters: query);
    final channel = connector(uri, sessionToken);
    _channel = channel;
    return channel.stream.cast<String>().map((event) {
      final value = jsonDecode(event);
      if (value is! Map<String, dynamic>) {
        throw const FormatException('实时事件格式不正确');
      }
      return value;
    });
  }

  Future<void> close() async {
    await _channel?.sink.close();
    _channel = null;
  }

  static Uri _buildUri(String serverUrl) {
    final base = Uri.parse(serverUrl);
    final scheme = base.scheme == 'https' ? 'wss' : 'ws';
    return base.replace(
        scheme: scheme,
        path: '${base.path.replaceFirst(RegExp(r'/$'), '')}/api/client/ws');
  }
}

typedef WebSocketConnector = WebSocketChannel Function(
    Uri uri, String sessionToken);

enum RealtimeStatus { disconnected, connecting, connected, reconnecting }

/// 管理实时连接生命周期；重复、乱序事件交由上层按 envelope/cursor 幂等投影。
class RealtimeSession {
  RealtimeSession(
      {required this.realtime,
      this.delays = const [500, 1000, 2000, 5000, 10000, 30000]});
  final MagicChatRealtime realtime;
  final List<int> delays;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Timer? _retry;
  RealtimeStatus status = RealtimeStatus.disconnected;
  int _cursor = 0;
  int _attempt = 0;
  bool _closed = false;

  Stream<Map<String, dynamic>> get events => _events.stream;

  Future<void> connect({int cursor = 0}) async {
    _cursor = cursor;
    _closed = false;
    _retry?.cancel();
    await _open();
  }

  Future<void> _open() async {
    if (_closed) return;
    status =
        _attempt == 0 ? RealtimeStatus.connecting : RealtimeStatus.reconnecting;
    await _subscription?.cancel();
    try {
      _subscription = realtime
          .connect(cursor: _cursor == 0 ? null : _cursor)
          .listen(_onEvent,
              onError: (_) => _scheduleRetry(), onDone: _scheduleRetry);
      status = RealtimeStatus.connected;
      _attempt = 0;
    } catch (_) {
      _scheduleRetry();
    }
  }

  void _onEvent(Map<String, dynamic> event) {
    final cursor = event['cursor'];
    if (cursor is num && cursor.toInt() > _cursor) _cursor = cursor.toInt();
    _events.add(event);
  }

  void _scheduleRetry() {
    if (_closed || _retry?.isActive == true) return;
    status = RealtimeStatus.reconnecting;
    final delay = delays.isEmpty
        ? 1000
        : delays[_attempt.clamp(0, delays.length - 1).toInt()];
    _attempt++;
    _retry = Timer(Duration(milliseconds: delay), _open);
  }

  Future<void> close() async {
    _closed = true;
    _retry?.cancel();
    await _subscription?.cancel();
    await realtime.close();
    status = RealtimeStatus.disconnected;
    await _events.close();
  }
}
