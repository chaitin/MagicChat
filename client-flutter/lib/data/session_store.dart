import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/services.dart';

class StoredAccount {
  const StoredAccount(
      {required this.id,
      required this.serverUrl,
      required this.token,
      this.email = '',
      this.name = '',
      this.status = 'ready'});
  final String id;
  final String serverUrl;
  final String token;
  final String email;
  final String name;
  final String status;
  Map<String, String> toJson() => {
        'id': id,
        'server_url': serverUrl,
        'token': token,
        'email': email,
        'name': name,
        'status': status
      };
  factory StoredAccount.fromJson(Map<String, dynamic> json) => StoredAccount(
      id: '${json['id'] ?? ''}',
      serverUrl: '${json['server_url'] ?? ''}',
      token: '${json['token'] ?? ''}',
      email: '${json['email'] ?? ''}',
      name: '${json['name'] ?? ''}',
      status:
          json['status'] == 'reauth-required' ? 'reauth-required' : 'ready');
}

class SessionStore {
  const SessionStore(
      {FlutterSecureStorage storage = const FlutterSecureStorage()})
      : _storage = storage;
  final FlutterSecureStorage _storage;
  static String? _fallbackToken;

  Future<String?> readToken() async {
    try {
      return await _storage.read(key: 'magicchat.session.token');
    } on PlatformException {
      return _fallbackToken;
    }
  }

  Future<void> writeToken(String token) async {
    _fallbackToken = token;
    try {
      await _storage.write(key: 'magicchat.session.token', value: token);
    } on PlatformException {
      // Linux may not have an unlocked desktop keyring (for example in CI).
    }
  }

  Future<void> clear() async {
    _fallbackToken = null;
    try {
      await _storage.delete(key: 'magicchat.session.token');
    } on PlatformException {
      // See writeToken: an unavailable keyring is not a fatal app error.
    }
  }

  Future<List<StoredAccount>> readAccounts() async {
    String? raw;
    try {
      raw = await _storage.read(key: 'magicchat.accounts');
    } on PlatformException {
      return const [];
    }
    if (raw == null) return const [];
    try {
      final value = jsonDecode(raw);
      return value is List
          ? value
              .whereType<Map<String, dynamic>>()
              .map(StoredAccount.fromJson)
              .where((item) => item.id.isNotEmpty && item.token.isNotEmpty)
              .toList()
          : const [];
    } catch (_) {
      return const [];
    }
  }

  Future<void> saveAccount(StoredAccount account) async {
    final accounts = await readAccounts();
    final updated = [
      ...accounts.where((item) => item.id != account.id),
      account
    ];
    try {
      await _storage.write(
          key: 'magicchat.accounts',
          value: jsonEncode(updated.map((item) => item.toJson()).toList()));
    } on PlatformException {
      // Account persistence is best effort when the desktop keyring is absent.
    }
  }

  Future<void> removeAccount(String accountId) async {
    final accounts = await readAccounts();
    try {
      await _storage.write(
          key: 'magicchat.accounts',
          value: jsonEncode(accounts
              .where((item) => item.id != accountId)
              .map((item) => item.toJson())
              .toList()));
    } on PlatformException {
      // Account persistence is best effort when the desktop keyring is absent.
    }
  }
}
