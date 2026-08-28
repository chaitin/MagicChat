import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// 跨平台语音录制适配。录音文件交给仓储以 multipart 方式发送。
class VoiceRecorder {
  final AudioRecorder _recorder = AudioRecorder();
  String? _path;

  bool get isRecording => _path != null;

  Future<void> start() async {
    if (_path != null) return;
    if (!await _recorder.hasPermission()) {
      throw const VoicePermissionDenied();
    }
    final directory = await getTemporaryDirectory();
    final path =
        '${directory.path}/magicchat-voice-${DateTime.now().microsecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc),
      path: path,
    );
    _path = path;
  }

  Future<String?> stop() async {
    final path = _path;
    if (path == null) return null;
    _path = null;
    return await _recorder.stop() ?? path;
  }

  Future<void> dispose() async {
    if (_path != null) await _recorder.stop();
    _path = null;
    await _recorder.dispose();
  }
}

class VoicePermissionDenied implements Exception {
  const VoicePermissionDenied();

  @override
  String toString() => '需要麦克风权限才能录制语音';
}
