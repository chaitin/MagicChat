import 'package:web_socket_channel/html.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// 浏览器 WebSocket API 不允许自定义 Header，使用服务端已有 HttpOnly 会话 Cookie。
WebSocketChannel connectWithAuthorization(Uri uri, String token) =>
    HtmlWebSocketChannel.connect(uri);
