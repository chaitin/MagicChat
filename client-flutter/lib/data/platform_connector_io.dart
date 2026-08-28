import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

WebSocketChannel connectWithAuthorization(Uri uri, String token) =>
    IOWebSocketChannel.connect(uri, headers: {
      'Authorization': 'Bearer $token',
      // document-server authenticates collaborative sockets via the
      // same user_session token used by the mobile session.
      'Cookie': 'user_session=$token',
    });
