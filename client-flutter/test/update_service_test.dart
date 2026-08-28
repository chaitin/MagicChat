import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:magicchat_client/data/update_service.dart';

void main() {
  test('只接受 HTTPS 下载地址并识别新版本', () async {
    final client = MockClient((request) async => http.Response(
        '{"android":{"version":"0.2.0","build":2,"url":"https://example.com/app.apk"}}',
        200));
    final release = await UpdateService(client: client).check();
    expect(release?.build, 2);
    expect(release?.url, startsWith('https://'));
  });
}
