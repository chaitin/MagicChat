import 'dart:io';
import 'package:path_provider/path_provider.dart';

class StorageInfo {
  const StorageInfo({required this.path, required this.bytes});
  final String path;
  final int bytes;
  String get formatted {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KiB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MiB';
  }
}

class StorageService {
  Future<Directory> _cacheDirectory() async => getTemporaryDirectory();
  Future<StorageInfo> inspect() async {
    final directory = await _cacheDirectory();
    return StorageInfo(path: directory.path, bytes: _size(directory));
  }

  Future<void> clearCache() async {
    final directory = await _cacheDirectory();
    if (!directory.existsSync()) return;
    for (final entity in directory.listSync()) {
      try {
        await entity.delete(recursive: true);
      } catch (_) {}
    }
  }

  int _size(FileSystemEntity entity) {
    if (entity is File) return entity.lengthSync();
    if (entity is Directory)
      return entity.listSync().fold<int>(0, (sum, item) => sum + _size(item));
    return 0;
  }
}
