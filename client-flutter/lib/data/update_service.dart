import 'dart:convert';
import 'package:http/http.dart' as http;

class AppRelease {
  const AppRelease(
      {required this.version, required this.build, required this.url});
  final String version;
  final int build;
  final String url;
}

class UpdateService {
  const UpdateService({http.Client? client}) : _client = client;
  final http.Client? _client;
  static const manifestUrl = 'https://jiying.chat/releases/version.json';
  static const currentBuild = 1;
  static const currentVersion = '0.1.0';

  Future<AppRelease?> check() async {
    final client = _client ?? http.Client();
    final separator = manifestUrl.contains('?') ? '&' : '?';
    final response = await client.get(
        Uri.parse(
            '$manifestUrl${separator}timestamp=${DateTime.now().millisecondsSinceEpoch}'),
        headers: {
          'Accept': 'application/json'
        }).timeout(const Duration(seconds: 15));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('版本服务返回 HTTP ${response.statusCode}');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>)
      throw const FormatException('版本文件格式不正确');
    final platform = decoded['android'] is Map<String, dynamic>
        ? decoded['android'] as Map<String, dynamic>
        : decoded['ios'];
    if (platform is! Map<String, dynamic>)
      throw const FormatException('版本文件缺少移动端配置');
    final version = platform['version'];
    final build = platform['build'];
    final url = platform['url'];
    if (version is! String ||
        version.trim().isEmpty ||
        build is! num ||
        build.toInt() < 0 ||
        url is! String ||
        !url.startsWith('https://')) {
      throw const FormatException('版本文件内容不正确');
    }
    final release =
        AppRelease(version: version.trim(), build: build.toInt(), url: url);
    return release.build > currentBuild ? release : null;
  }
}
