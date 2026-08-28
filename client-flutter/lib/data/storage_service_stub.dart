class StorageInfo {
  const StorageInfo({required this.path, required this.bytes});
  final String path;
  final int bytes;
  String get formatted => '$bytes B';
}

class StorageService {
  Future<StorageInfo> inspect() async =>
      const StorageInfo(path: '浏览器缓存', bytes: 0);
  Future<void> clearCache() async {}
}
