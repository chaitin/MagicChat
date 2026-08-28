import 'dart:async';
import 'dart:typed_data';
import 'package:web_socket_channel/web_socket_channel.dart';

typedef DocumentSocketConnector = WebSocketChannel Function(
    Uri uri, String token);

/// 文档协作二进制桥接。协议帧由编辑器（如 Yjs/Hocuspocus）解释，本层只负责鉴权、限流和生命周期。
class DocumentRealtime {
  DocumentRealtime(
      {required String serverUrl,
      required this.token,
      required this.connector,
      this.maxFrameBytes = 16 * 1024 * 1024})
      : _uri = _buildUri(serverUrl);
  final Uri _uri;
  final String token;
  final DocumentSocketConnector connector;
  final int maxFrameBytes;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  final _events = StreamController<Uint8List>.broadcast();
  Stream<Uint8List> get events => _events.stream;
  bool _closed = false;

  Future<void> connect() async {
    _closed = false;
    final channel = connector(_uri, token);
    _channel = channel;
    _subscription = channel.stream.listen(
        (value) {
          if (_closed) return;
          final frame = _bytes(value);
          if (frame == null || frame.isEmpty || frame.length > maxFrameBytes)
            return;
          _events.add(frame);
        },
        onError: _events.addError,
        onDone: () {
          if (!_closed) _events.close();
        });
  }

  Future<void> send(Uint8List frame) async {
    if (_closed || frame.isEmpty || frame.length > maxFrameBytes)
      throw StateError('文档协作帧无效');
    _channel?.sink.add(frame);
  }

  Future<void> close() async {
    _closed = true;
    await _subscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    await _events.close();
  }

  Uint8List? _bytes(dynamic value) {
    if (value is Uint8List) return Uint8List.fromList(value);
    if (value is List<int>) return Uint8List.fromList(value);
    if (value is ByteBuffer) return Uint8List.fromList(value.asUint8List());
    return null;
  }

  static Uri _buildUri(String serverUrl) {
    final base = Uri.parse(serverUrl);
    final scheme = base.scheme == 'https' ? 'wss' : 'ws';
    return base.replace(
        scheme: scheme,
        path:
            '${base.path.replaceFirst(RegExp(r'/$'), '')}/api/client/document/collaboration');
  }
}
