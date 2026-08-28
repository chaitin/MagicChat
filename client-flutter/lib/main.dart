import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'data/repository.dart';
import 'data/auth_service.dart';
import 'data/session_store.dart';
import 'data/platform_connector_selector.dart';
import 'data/realtime.dart';
import 'data/realtime_store.dart';
import 'data/storage_service.dart';
import 'data/push_service.dart';
import 'data/local_notification_service.dart';
import 'data/update_service.dart';
import 'data/voice_recorder.dart';
import 'data/avatar_processor.dart';
import 'features/qr_scanner_page.dart';
import 'domain/models.dart';
import 'domain/message_content.dart';

Uri? _resolveAssetUri(String? serverUrl, String value) {
  final parsed = Uri.tryParse(value);
  if (parsed == null || value.trim().isEmpty) return null;
  if (parsed.hasScheme) return parsed;
  final server = Uri.tryParse(serverUrl ?? '');
  return server == null ? null : server.resolve(value);
}

void main() => runApp(const MagicChatApp());

class MagicChatApp extends StatefulWidget {
  const MagicChatApp({super.key});
  @override
  State<MagicChatApp> createState() => _MagicChatAppState();
}

class _MagicChatAppState extends State<MagicChatApp> {
  MagicChatRepository? _repository;
  RealtimeSession? _realtime;
  final _realtimeStore = RealtimeStore();
  ThemeMode _themeMode = ThemeMode.system;
  String? _serverUrl;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final server = prefs.getString('magicchat.server_url');
    final token = await const SessionStore().readToken();
    final theme = prefs.getString('magicchat.theme');
    if (!mounted) return;
    setState(() {
      _serverUrl = server;
      _repository = server != null && token != null
          ? HttpMagicChatRepository(serverUrl: server, sessionToken: token)
          : null;
      _realtime = server != null && token != null
          ? RealtimeSession(
              realtime: MagicChatRealtime(
                  serverUrl: server,
                  sessionToken: token,
                  connector: connectWithAuthorization))
          : null;
      _loading = false;
      _themeMode = switch (theme) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
    });
  }

  Future<void> _login(String server, String email, String password) async {
    await AuthService()
        .login(serverUrl: server, email: email, password: password);
    final prefs = await SharedPreferences.getInstance();
    final token = await const SessionStore().readToken();
    await prefs.setString('magicchat.server_url', server);
    if (!mounted || token == null) return;
    await const SessionStore().saveAccount(StoredAccount(
        id: '$server|$email', serverUrl: server, token: token, email: email));
    setState(() => _repository =
        HttpMagicChatRepository(serverUrl: server, sessionToken: token));
    setState(() => _serverUrl = server);
    setState(() => _realtime = RealtimeSession(
        realtime: MagicChatRealtime(
            serverUrl: server,
            sessionToken: token,
            connector: connectWithAuthorization)));
    unawaited(_registerPush(server, token));
  }

  Future<void> _loginWithCode(String server, String email, String code) async {
    await AuthService()
        .loginWithEmailCode(serverUrl: server, email: email, code: code);
    final prefs = await SharedPreferences.getInstance();
    final token = await const SessionStore().readToken();
    await prefs.setString('magicchat.server_url', server);
    if (!mounted || token == null) return;
    await const SessionStore().saveAccount(StoredAccount(
        id: '$server|$email', serverUrl: server, token: token, email: email));
    setState(() {
      _serverUrl = server;
      _repository =
          HttpMagicChatRepository(serverUrl: server, sessionToken: token);
      _realtime = RealtimeSession(
          realtime: MagicChatRealtime(
              serverUrl: server,
              sessionToken: token,
              connector: connectWithAuthorization));
    });
    unawaited(_registerPush(server, token));
  }

  Future<void> _registerPush(String server, String token) async {
    try {
      await PushService().registerPlatformGrant(
          serverUrl: server,
          sessionToken: token,
          platform: defaultTargetPlatform.name);
    } catch (_) {
      // Push registration is optional; login must not be blocked by a plugin
      // or network failure.
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    final server = prefs.getString('magicchat.server_url');
    if (server != null) {
      await AuthService().logout(serverUrl: server);
    }
    await prefs.remove('magicchat.server_url');
    await _realtime?.close();
    if (mounted) {
      setState(() {
        _repository = null;
        _realtime = null;
        _serverUrl = null;
      });
    }
  }

  Future<void> _setTheme(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('magicchat.theme', mode.name);
    if (mounted) setState(() => _themeMode = mode);
  }

  Future<void> _changeServer(String server) async {
    final normalized = server.trim().replaceFirst(RegExp(r'/+$'), '');
    if (normalized.isEmpty) return;
    await _realtime?.close();
    await const SessionStore().clear();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('magicchat.server_url', normalized);
    if (mounted)
      setState(() {
        _repository = null;
        _realtime = null;
        _serverUrl = normalized;
      });
  }

  Future<void> _switchAccount(StoredAccount account) async {
    await _realtime?.close();
    await const SessionStore().writeToken(account.token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('magicchat.server_url', account.serverUrl);
    if (!mounted) return;
    setState(() {
      _serverUrl = account.serverUrl;
      _repository = HttpMagicChatRepository(
          serverUrl: account.serverUrl, sessionToken: account.token);
      _realtime = RealtimeSession(
          realtime: MagicChatRealtime(
              serverUrl: account.serverUrl,
              sessionToken: account.token,
              connector: connectWithAuthorization));
    });
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'MagicChat',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
                seedColor: const Color(0xff3a76f0),
                brightness: Brightness.light),
            scaffoldBackgroundColor: const Color(0xfff7f8fa),
            appBarTheme: const AppBarTheme(
                backgroundColor: Color(0xfff7f8fa),
                surfaceTintColor: Colors.transparent,
                elevation: 0,
                centerTitle: false),
            inputDecorationTheme: InputDecorationTheme(
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(12)),
                    borderSide: BorderSide.none),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(12)),
                    borderSide: BorderSide.none),
                focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(12)),
                    borderSide:
                        BorderSide(color: Color(0xff3a76f0), width: 1.5)),
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
            cardTheme: const CardThemeData(
                elevation: 0,
                margin: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.all(Radius.circular(16)))),
            useMaterial3: true),
        darkTheme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
                seedColor: const Color(0xff3a76f0),
                brightness: Brightness.dark),
            scaffoldBackgroundColor: const Color(0xff17191c),
            appBarTheme: const AppBarTheme(
                surfaceTintColor: Colors.transparent, elevation: 0),
            inputDecorationTheme: const InputDecorationTheme(
                filled: true,
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(12)),
                    borderSide: BorderSide.none)),
            cardTheme: const CardThemeData(
                elevation: 0,
                margin: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.all(Radius.circular(16)))),
            useMaterial3: true),
        themeMode: _themeMode,
        home: _loading
            ? const Scaffold(body: Center(child: CircularProgressIndicator()))
            : _repository == null
                ? LoginPage(
                    onLogin: _login,
                    onCodeLogin: _loginWithCode,
                    initialServer: _serverUrl)
                : AppShell(
                    repository: _repository!,
                    serverUrl: _serverUrl,
                    onServerChanged: _changeServer,
                    onAccountSwitch: _switchAccount,
                    realtime: _realtime,
                    realtimeStore: _realtimeStore,
                    onLogout: _logout,
                    onThemeChanged: _setTheme,
                    themeMode: _themeMode),
      );
}

class LoginPage extends StatefulWidget {
  const LoginPage(
      {required this.onLogin,
      required this.onCodeLogin,
      this.initialServer,
      super.key});
  final Future<void> Function(String server, String email, String password)
      onLogin;
  final Future<void> Function(String server, String email, String code)
      onCodeLogin;
  final String? initialServer;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  late final TextEditingController _server = TextEditingController(
      text: widget.initialServer ?? 'https://app.jiying.chat');
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  bool _codeMode = false;
  String? _error;
  @override
  void dispose() {
    _server.dispose();
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      body: Center(
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Card(
                      child: Padding(
                          padding: const EdgeInsets.all(24),
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                            Text('登录 MagicChat',
                                style:
                                    Theme.of(context).textTheme.headlineSmall),
                            const SizedBox(height: 24),
                            TextField(
                                controller: _server,
                                decoration: const InputDecoration(
                                    labelText: '服务器地址',
                                    prefixIcon: Icon(Icons.dns))),
                            const SizedBox(height: 12),
                            TextField(
                                controller: _email,
                                keyboardType: TextInputType.emailAddress,
                                decoration:
                                    const InputDecoration(labelText: '邮箱')),
                            const SizedBox(height: 8),
                            Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                    onPressed: _busy
                                        ? null
                                        : () => setState(
                                            () => _codeMode = !_codeMode),
                                    child: Text(
                                        _codeMode ? '使用密码登录' : '使用邮箱验证码登录'))),
                            if (_codeMode) ...[
                              TextField(
                                  controller: _code,
                                  keyboardType: TextInputType.number,
                                  decoration: InputDecoration(
                                      labelText: '邮箱验证码',
                                      suffixIcon: TextButton(
                                          onPressed: _busy
                                              ? null
                                              : () async {
                                                  try {
                                                    await AuthService()
                                                        .requestEmailCode(
                                                            serverUrl: _server
                                                                .text
                                                                .trim(),
                                                            email: _email.text
                                                                .trim());
                                                    if (mounted)
                                                      ScaffoldMessenger.of(
                                                              context)
                                                          .showSnackBar(
                                                              const SnackBar(
                                                                  content: Text(
                                                                      '验证码已发送')));
                                                  } catch (error) {
                                                    if (mounted)
                                                      setState(() => _error =
                                                          error.toString());
                                                  }
                                                },
                                          child: const Text('发送')))),
                            ] else
                              TextField(
                                  controller: _password,
                                  obscureText: true,
                                  decoration:
                                      const InputDecoration(labelText: '密码')),
                            if (_error != null)
                              Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: Text(_error!,
                                      style: TextStyle(
                                          color: Theme.of(context)
                                              .colorScheme
                                              .error))),
                            const SizedBox(height: 20),
                            SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                    onPressed: _busy
                                        ? null
                                        : () async {
                                            setState(() {
                                              _busy = true;
                                              _error = null;
                                            });
                                            try {
                                              if (_codeMode) {
                                                await widget.onCodeLogin(
                                                    _server.text.trim(),
                                                    _email.text.trim(),
                                                    _code.text.trim());
                                              } else {
                                                await widget.onLogin(
                                                    _server.text.trim(),
                                                    _email.text.trim(),
                                                    _password.text);
                                              }
                                            } catch (error) {
                                              if (mounted) {
                                                setState(() =>
                                                    _error = error.toString());
                                              }
                                            } finally {
                                              if (mounted) {
                                                setState(() => _busy = false);
                                              }
                                            }
                                          },
                                    child: _busy
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(
                                                strokeWidth: 2))
                                        : const Text('登录')))
                          ])))))));
}

class AppShell extends StatefulWidget {
  const AppShell(
      {required this.repository,
      this.serverUrl,
      this.onServerChanged,
      this.onAccountSwitch,
      this.realtime,
      this.realtimeStore,
      this.onLogout,
      this.onThemeChanged,
      this.themeMode = ThemeMode.system,
      super.key});
  final MagicChatRepository repository;
  final String? serverUrl;
  final ValueChanged<String>? onServerChanged;
  final ValueChanged<StoredAccount>? onAccountSwitch;
  final RealtimeSession? realtime;
  final RealtimeStore? realtimeStore;
  final Future<void> Function()? onLogout;
  final ValueChanged<ThemeMode>? onThemeChanged;
  final ThemeMode themeMode;
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late final MagicChatRepository _repository = widget.repository;
  int _index = 0;
  String? _selectedConversation;
  StreamSubscription<Map<String, dynamic>>? _realtimeSubscription;
  final _notifications = const LocalNotificationService();

  @override
  void initState() {
    super.initState();
    final realtime = widget.realtime;
    final store = widget.realtimeStore;
    if (realtime != null && store != null) {
      _realtimeSubscription = realtime.events.listen((event) {
        store.apply(event);
        _notifyIncomingMessage(event);
      });
      realtime.connect();
    }
    _resolveNotificationRoute();
  }

  Future<void> _notifyIncomingMessage(Map<String, dynamic> event) async {
    if (event['event'] != 'message.created') return;
    final payload = event['payload'];
    if (payload is! Map<String, dynamic>) return;
    final conversationId = payload['conversation_id'];
    if (conversationId is! String || conversationId == _selectedConversation) {
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    if (!(prefs.getBool('magicchat.notifications.enabled') ?? true)) return;
    final sender = payload['sender'];
    final title = sender is Map<String, dynamic> && sender['name'] is String
        ? sender['name'] as String
        : '新消息';
    final body = MessageContent.parse(payload['body']).text;
    await _notifications.showMessage(
        conversationId: conversationId, title: title, body: body);
  }

  Future<void> _resolveNotificationRoute() async {
    final routeToken = Uri.base.queryParameters['route_token'];
    if (routeToken == null || routeToken.isEmpty || widget.serverUrl == null)
      return;
    try {
      final token = await const SessionStore().readToken();
      if (token == null) return;
      final route = await PushService().resolveRoute(
          serverUrl: widget.serverUrl!,
          sessionToken: token,
          routeToken: routeToken);
      if (mounted) setState(() => _selectedConversation = route.conversationId);
    } catch (_) {
      // 通知路由失效时保留正常首页，不阻断主应用启动。
    }
  }

  @override
  void dispose() {
    _realtimeSubscription?.cancel();
    widget.realtime?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 800;
    final pages = <Widget>[
      MessagesPage(
          repository: _repository,
          serverUrl: widget.serverUrl,
          realtimeStore: widget.realtimeStore,
          selectedId: _selectedConversation,
          onSelect: (id) =>
              setState(() => _selectedConversation = id.isEmpty ? null : id)),
      ContactsPage(
          repository: _repository,
          onOpenConversation: (id) => setState(() {
                _selectedConversation = id;
                _index = 0;
              })),
      ProjectsPage(repository: _repository),
      SettingsPage(
          repository: _repository,
          serverUrl: widget.serverUrl,
          onServerChanged: widget.onServerChanged,
          onAccountSwitch: widget.onAccountSwitch,
          onLogout: widget.onLogout,
          onThemeChanged: widget.onThemeChanged,
          themeMode: widget.themeMode),
    ];
    const destinations = [
      NavigationDestination(
          icon: Icon(Icons.chat_bubble_outline),
          selectedIcon: Icon(Icons.chat_bubble),
          label: '消息'),
      NavigationDestination(
          icon: Icon(Icons.people_outline),
          selectedIcon: Icon(Icons.people),
          label: '联系人'),
      NavigationDestination(
          icon: Icon(Icons.folder_outlined),
          selectedIcon: Icon(Icons.folder),
          label: '项目'),
      NavigationDestination(
          icon: Icon(Icons.settings_outlined),
          selectedIcon: Icon(Icons.settings),
          label: '设置'),
    ];
    return Scaffold(
      appBar: AppBar(
          title: const Text('MagicChat',
              style:
                  TextStyle(fontWeight: FontWeight.w700, letterSpacing: -.2)),
          actions: [
            IconButton(
                onPressed: () => _showSearch(context),
                icon: const Icon(Icons.search),
                tooltip: '搜索')
          ]),
      body: Row(children: [
        if (wide)
          NavigationRail(
              backgroundColor: Theme.of(context).scaffoldBackgroundColor,
              useIndicator: true,
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              labelType: NavigationRailLabelType.all,
              destinations: destinations
                  .map((d) => NavigationRailDestination(
                      icon: d.icon,
                      selectedIcon: d.selectedIcon,
                      label: Text(d.label)))
                  .toList()),
        Expanded(child: pages[_index])
      ]),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              backgroundColor: Theme.of(context).colorScheme.surface,
              elevation: 0,
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              destinations: destinations),
    );
  }

  Future<void> _showSearch(BuildContext context) async {
    final controller = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('搜索聊天记录'),
        content: SizedBox(
          width: 520,
          child: StatefulBuilder(
            builder: (context, setDialogState) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  minLines: 1,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: '关键词（至少 2 个字符）'),
                  onChanged: (_) => setDialogState(() {}),
                  onSubmitted: (_) => setDialogState(() {}),
                ),
                const SizedBox(height: 12),
                if (controller.text.trim().length >= 2)
                  FutureBuilder<List<MessageSearchResult>>(
                    future: _repository.searchMessages(controller.text.trim()),
                    builder: (context, snapshot) {
                      if (!snapshot.hasData) {
                        return const CircularProgressIndicator();
                      }
                      if (snapshot.data!.isEmpty) return const Text('没有匹配的消息');
                      return ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 280),
                        child: ListView(
                          shrinkWrap: true,
                          children: snapshot.data!
                              .map((result) => ListTile(
                                    title: Text(result.message.text,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis),
                                    subtitle: Text(result.conversationName),
                                    onTap: () {
                                      Navigator.pop(context);
                                      setState(() => _selectedConversation =
                                          result.conversationId);
                                    },
                                  ))
                              .toList(),
                        ),
                      );
                    },
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: const Text('关闭'))
        ],
      ),
    );
    controller.dispose();
  }
}

class MessagesPage extends StatelessWidget {
  const MessagesPage(
      {required this.repository,
      this.serverUrl,
      this.realtimeStore,
      required this.selectedId,
      required this.onSelect,
      super.key});
  final MagicChatRepository repository;
  final String? serverUrl;
  final RealtimeStore? realtimeStore;
  final String? selectedId;
  final ValueChanged<String> onSelect;
  @override
  Widget build(BuildContext context) =>
      LayoutBuilder(builder: (context, constraints) {
        final split = constraints.maxWidth >= 700;
        // 移动端使用单列导航：选择会话后进入聊天，返回按钮回到列表。
        if (!split && selectedId != null) {
          return Column(children: [
            Material(
              color: Theme.of(context).colorScheme.surfaceContainer,
              child: SizedBox(
                height: 52,
                child: Row(children: [
                  IconButton(
                    tooltip: '返回会话列表',
                    onPressed: () => onSelect(''),
                    icon: const Icon(Icons.arrow_back),
                  ),
                  const Text('聊天',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
            Expanded(
              child: ConversationView(
                repository: repository,
                realtimeStore: realtimeStore,
                conversationId: selectedId,
              ),
            ),
          ]);
        }
        return Stack(children: [
          Row(children: [
            SizedBox(
                width: split ? 300 : constraints.maxWidth,
                child: _ConversationList(
                    repository: repository,
                    serverUrl: serverUrl,
                    selectedId: selectedId,
                    onSelect: onSelect)),
            if (split)
              Expanded(
                  child: ConversationView(
                      repository: repository,
                      realtimeStore: realtimeStore,
                      conversationId: selectedId))
          ]),
          Positioned(
              right: 16,
              bottom: 16,
              child: FloatingActionButton(
                  onPressed: () => _createGroup(context),
                  child: const Icon(Icons.group_add),
                  tooltip: '新建群聊')),
        ]);
      });

  Future<void> _createGroup(BuildContext context) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('新建群聊'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: '群聊名称')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(context, controller.text.trim()),
                    child: const Text('创建'))
              ],
            ));
    controller.dispose();
    if (name == null || name.isEmpty || !context.mounted) return;
    try {
      final members = await _selectMembers(context);
      if (members == null || !context.mounted) return;
      final conversation =
          await repository.createGroupConversation(name, memberIds: members);
      if (context.mounted) onSelect(conversation.id);
    } catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('创建失败：$error')));
    }
  }

  Future<List<String>?> _selectMembers(BuildContext context) async {
    final contacts = await repository.contacts();
    if (!context.mounted) return null;
    final selected = <String>{};
    return showDialog<List<String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          final list = contacts
              .map((contact) => CheckboxListTile(
                    value: selected.contains(contact.id),
                    title: Text(contact.name),
                    onChanged: (checked) => setDialogState(() {
                      if (checked == true) {
                        selected.add(contact.id);
                      } else {
                        selected.remove(contact.id);
                      }
                    }),
                  ))
              .toList();
          return AlertDialog(
            title: const Text('选择群成员'),
            content: SizedBox(
                width: 360,
                height: 320,
                child: list.isEmpty
                    ? const Center(child: Text('暂无联系人'))
                    : ListView(children: list)),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('取消')),
              FilledButton(
                  onPressed: () =>
                      Navigator.pop(dialogContext, selected.toList()),
                  child: const Text('完成')),
            ],
          );
        },
      ),
    );
  }
}

class _ConversationList extends StatefulWidget {
  const _ConversationList(
      {required this.repository,
      this.serverUrl,
      required this.selectedId,
      required this.onSelect});
  final MagicChatRepository repository;
  final String? serverUrl;
  final String? selectedId;
  final ValueChanged<String> onSelect;
  @override
  State<_ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends State<_ConversationList> {
  Future<List<ChatConversation>>? _future;
  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => _future = widget.repository.conversations();

  @override
  Widget build(BuildContext context) => FutureBuilder<List<ChatConversation>>(
      future: _future,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        return ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            itemCount: snapshot.data!.length,
            separatorBuilder: (_, __) => const SizedBox(height: 2),
            itemBuilder: (context, i) {
              final c = snapshot.data![i];
              return ListTile(
                  minVerticalPadding: 10,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  selected: c.id == widget.selectedId,
                  selectedTileColor:
                      Theme.of(context).colorScheme.primaryContainer,
                  leading: CircleAvatar(
                      radius: 23,
                      backgroundImage:
                          _resolveAssetUri(widget.serverUrl, c.avatar) == null
                              ? null
                              : NetworkImage(
                                  _resolveAssetUri(widget.serverUrl, c.avatar)!
                                      .toString()),
                      child: c.avatar.isEmpty
                          ? Text(
                              c.title.isEmpty ? '?' : c.title.substring(0, 1))
                          : null),
                  title: Text(c.title,
                      style: TextStyle(
                          fontWeight: c.unread > 0
                              ? FontWeight.w700
                              : FontWeight.w500)),
                  subtitle: Text(
                      c.announcement.isNotEmpty ? '公告：${c.announcement}' : c.preview,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontWeight: c.unread > 0 ? FontWeight.w600 : null)),
                  trailing: c.unread == 0 ? null : Badge(label: Text('${c.unread}')),
                  onTap: () async {
                    widget.onSelect(c.id);
                    if (c.unread > 0 && c.lastMessageSeq > 0) {
                      await widget.repository
                          .markConversationRead(c.id, c.lastMessageSeq);
                    }
                  },
                  onLongPress: () => _showConversationActions(context, c));
            });
      });

  Future<void> _showConversationActions(
      BuildContext context, ChatConversation conversation) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => SafeArea(
                child: Wrap(children: [
              ListTile(
                  leading: const Icon(Icons.push_pin_outlined),
                  title: Text(conversation.pinned ? '取消置顶' : '置顶会话'),
                  onTap: () => Navigator.pop(
                      context, conversation.pinned ? 'unpin' : 'pin')),
              ListTile(
                  leading: const Icon(Icons.notifications_off_outlined),
                  title: Text(conversation.muted ? '取消免打扰' : '消息免打扰'),
                  onTap: () => Navigator.pop(
                      context, conversation.muted ? 'unmute' : 'mute')),
              ListTile(
                  leading: const Icon(Icons.archive_outlined),
                  title: const Text('从列表移除'),
                  onTap: () => Navigator.pop(context, 'dismiss')),
              ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: const Text('修改群名称'),
                  onTap: () => Navigator.pop(context, 'rename')),
              ListTile(
                  leading: const Icon(Icons.campaign_outlined),
                  title: const Text('修改群公告'),
                  onTap: () => Navigator.pop(context, 'announcement')),
              ListTile(
                  leading: const Icon(Icons.public_outlined),
                  title: Text(conversation.isPublic ? '设为私有群' : '设为公开群'),
                  onTap: () => Navigator.pop(context, 'visibility')),
              ListTile(
                  leading: const Icon(Icons.image_outlined),
                  title: const Text('修改群头像'),
                  onTap: () => Navigator.pop(context, 'avatar')),
              ListTile(
                  leading: const Icon(Icons.person_add_outlined),
                  title: const Text('添加群成员'),
                  onTap: () => Navigator.pop(context, 'members')),
              if (conversation.members.isNotEmpty)
                ListTile(
                    leading: const Icon(Icons.person_remove_outlined),
                    title: const Text('移除群成员'),
                    onTap: () => Navigator.pop(context, 'remove_member')),
            ])));
    if (!context.mounted || action == null) return;
    if (action == 'pin' || action == 'unpin') {
      await widget.repository
          .setConversationPinned(conversation.id, action == 'pin');
    } else if (action == 'mute' || action == 'unmute') {
      await widget.repository
          .setConversationMuted(conversation.id, action == 'mute');
    } else if (action == 'dismiss') {
      await widget.repository.dismissConversation(conversation.id);
    } else if (action == 'rename') {
      final controller = TextEditingController(text: conversation.title);
      final name = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('修改群名称'),
                content: TextField(controller: controller, autofocus: true),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () =>
                          Navigator.pop(context, controller.text.trim()),
                      child: const Text('保存'))
                ],
              ));
      controller.dispose();
      if (name != null && name.isNotEmpty && context.mounted) {
        await widget.repository.renameGroupConversation(conversation.id, name);
      }
    } else if (action == 'announcement') {
      final controller = TextEditingController();
      final announcement = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('修改群公告'),
                content: TextField(
                    controller: controller,
                    autofocus: true,
                    maxLength: 200,
                    maxLines: 4,
                    decoration: const InputDecoration(hintText: '留空可清除群公告')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, controller.text),
                      child: const Text('保存'))
                ],
              ));
      controller.dispose();
      if (announcement != null && context.mounted) {
        await widget.repository
            .updateGroupAnnouncement(conversation.id, announcement.trim());
      }
    } else if (action == 'visibility') {
      await widget.repository
          .setGroupVisibility(conversation.id, !conversation.isPublic);
    } else if (action == 'avatar') {
      final result =
          await FilePicker.pickFiles(type: FileType.image, withData: true);
      if (result == null || !context.mounted) return;
      final file = result.files.single;
      final rawBytes = file.bytes;
      if (rawBytes == null) return;
      final processed = const AvatarProcessor().process(rawBytes);
      await widget.repository.uploadConversationAvatar(
          conversation.id,
          AttachmentUpload(
              path: file.path ?? '',
              name: 'group-avatar.webp',
              mimeType: 'image/webp',
              bytes: processed));
    } else if (action == 'members') {
      final contacts = await widget.repository.contacts();
      if (!context.mounted) return;
      final selected = <String>{};
      final members = await showDialog<List<String>>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('添加群成员'),
            content: SizedBox(
                width: 360,
                height: 320,
                child: ListView(
                    children: contacts
                        .map((contact) => CheckboxListTile(
                              value: selected.contains(contact.id),
                              title: Text(contact.name),
                              onChanged: (checked) => setDialogState(() {
                                if (checked == true) {
                                  selected.add(contact.id);
                                } else {
                                  selected.remove(contact.id);
                                }
                              }),
                            ))
                        .toList())),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('取消')),
              FilledButton(
                  onPressed: () =>
                      Navigator.pop(dialogContext, selected.toList()),
                  child: const Text('添加')),
            ],
          ),
        ),
      );
      if (members != null && members.isNotEmpty && context.mounted) {
        await widget.repository
            .addConversationMembers(conversation.id, memberIds: members);
      }
    } else if (action == 'remove_member') {
      final member = await showDialog<Contact>(
          context: context,
          builder: (dialogContext) => SimpleDialog(
                title: const Text('选择要移除的成员'),
                children: conversation.members
                    .map((item) => SimpleDialogOption(
                        onPressed: () => Navigator.pop(dialogContext, item),
                        child: Text(item.name)))
                    .toList(),
              ));
      if (member != null && context.mounted) {
        await widget.repository
            .removeConversationMember(conversation.id, member.id);
      }
    }
    if (mounted) setState(_reload);
  }
}

class ConversationView extends StatefulWidget {
  const ConversationView(
      {required this.repository,
      this.realtimeStore,
      required this.conversationId,
      super.key});
  final MagicChatRepository repository;
  final RealtimeStore? realtimeStore;
  final String? conversationId;
  @override
  State<ConversationView> createState() => _ConversationViewState();
}

class _ConversationViewState extends State<ConversationView> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _voiceRecorder = VoiceRecorder();
  Future<List<ChatMessage>>? _messagesFuture;
  bool _sendingFile = false;
  bool _recording = false;
  Future<List<Contact>>? _contactsFuture;
  final _olderMessages = <ChatMessage>[];
  bool _loadingOlder = false;
  int _lastReadSequence = 0;
  final _selectedMessageIds = <String>{};
  List<ChatMessage> _visibleMessages = const [];

  @override
  void initState() {
    super.initState();
    _messagesFuture = _loadMessages();
    _contactsFuture = widget.repository.contacts();
    _scrollController.addListener(_onScroll);
    _controller.addListener(_persistDraft);
    widget.realtimeStore?.addListener(_onRealtimeChanged);
    unawaited(_restoreDraft());
  }

  String? get _draftKey => widget.conversationId == null
      ? null
      : 'magicchat.conversation.${widget.conversationId}.draft';

  Future<void> _restoreDraft() async {
    final key = _draftKey;
    if (key == null) return;
    final prefs = await SharedPreferences.getInstance();
    final draft = prefs.getString(key);
    if (draft != null && mounted && _controller.text.isEmpty) {
      _controller.value = TextEditingValue(
          text: draft,
          selection: TextSelection.collapsed(offset: draft.length));
    }
  }

  void _persistDraft() {
    final key = _draftKey;
    if (key == null) return;
    unawaited(SharedPreferences.getInstance().then((prefs) async {
      final draft = _controller.text;
      if (draft.trim().isEmpty) {
        await prefs.remove(key);
      } else {
        await prefs.setString(key, draft);
      }
    }));
  }

  Future<List<ChatMessage>> _loadMessages() {
    final id = widget.conversationId;
    return id == null ? Future.value(const []) : widget.repository.messages(id);
  }

  void _onRealtimeChanged() {
    if (mounted) setState(() {});
  }

  void _markLatestRead(List<ChatMessage> messages, String conversationId) {
    final latest = messages
        .where((message) => message.sequence != null)
        .fold<int>(0, (value, message) => max(value, message.sequence!));
    if (latest <= 0 || latest <= _lastReadSequence) return;
    final atBottom = !_scrollController.hasClients ||
        _scrollController.position.maxScrollExtent -
                _scrollController.position.pixels <
            48;
    if (!atBottom) return;
    _lastReadSequence = latest;
    unawaited(widget.repository.markConversationRead(conversationId, latest));
  }

  Future<void> _onScroll() async {
    if (_loadingOlder ||
        !_scrollController.hasClients ||
        _scrollController.position.pixels > 24) return;
    final id = widget.conversationId;
    if (id == null || !mounted) return;
    final snapshot = await _messagesFuture;
    if (snapshot == null || snapshot.isEmpty) return;
    final first = [..._olderMessages, ...snapshot]
        .where((message) => message.sequence != null)
        .fold<ChatMessage?>(
            null,
            (current, message) =>
                current == null || message.sequence! < current.sequence!
                    ? message
                    : current);
    if (first?.sequence == null || first!.sequence! <= 1) return;
    setState(() => _loadingOlder = true);
    try {
      final older = await widget.repository
          .messages(id, beforeSeq: first.sequence, limit: 50);
      if (mounted) {
        final existing =
            {..._olderMessages, ...snapshot}.map((item) => item.id).toSet();
        _olderMessages.insertAll(
            0, older.where((item) => !existing.contains(item.id)));
        setState(() {});
      }
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  @override
  void didUpdateWidget(covariant ConversationView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.realtimeStore != widget.realtimeStore) {
      oldWidget.realtimeStore?.removeListener(_onRealtimeChanged);
      widget.realtimeStore?.addListener(_onRealtimeChanged);
    }
    if (oldWidget.conversationId != widget.conversationId) {
      _olderMessages.clear();
      _lastReadSequence = 0;
      _messagesFuture = _loadMessages();
      _controller.clear();
      unawaited(_restoreDraft());
    }
  }

  @override
  void dispose() {
    widget.realtimeStore?.removeListener(_onRealtimeChanged);
    _persistDraft();
    _controller.removeListener(_persistDraft);
    _controller.dispose();
    _scrollController.dispose();
    _voiceRecorder.dispose();
    super.dispose();
  }

  Future<void> _toggleVoice(String conversationId) async {
    if (_recording) {
      try {
        final path = await _voiceRecorder.stop();
        if (mounted) setState(() => _recording = false);
        if (path == null) return;
        await widget.repository.sendVoice(
            conversationId,
            AttachmentUpload(
                path: path, name: 'voice.m4a', mimeType: 'audio/mp4'));
        if (mounted) setState(() => _messagesFuture = _loadMessages());
      } catch (error) {
        if (mounted) {
          setState(() => _recording = false);
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('发送语音失败：$error')));
        }
      }
      return;
    }
    try {
      await _voiceRecorder.start();
      if (mounted) setState(() => _recording = true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('无法开始录音：$error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final conversationId = widget.conversationId;
    if (conversationId == null) return const Center(child: Text('选择一个会话开始聊天'));
    return Column(
      children: [
        if (_selectedMessageIds.isNotEmpty)
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Row(children: [
              IconButton(
                  tooltip: '取消多选',
                  onPressed: () => setState(_selectedMessageIds.clear),
                  icon: const Icon(Icons.close)),
              Expanded(child: Text('已选择 ${_selectedMessageIds.length} 条消息')),
              IconButton(
                  tooltip: '复制',
                  icon: const Icon(Icons.copy_outlined),
                  onPressed: _copySelected),
              IconButton(
                  tooltip: '撤回所选',
                  icon: const Icon(Icons.undo),
                  onPressed: () => _revokeSelected(conversationId)),
            ]),
          ),
        Expanded(
          child: FutureBuilder<List<ChatMessage>>(
            future: _messagesFuture,
            builder: (context, snapshot) {
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final realtimeMessages = widget.realtimeStore?.messages.values
                  .where((message) =>
                      message.id.isNotEmpty &&
                      message.conversationId == conversationId)
                  .toList();
              final messages =
                  realtimeMessages == null || realtimeMessages.isEmpty
                      ? snapshot.data!
                      : [...snapshot.data!, ...realtimeMessages];
              final allMessages = [..._olderMessages, ...messages]
                  .fold<List<ChatMessage>>([], (result, message) {
                if (!result.any((item) => item.id == message.id))
                  result.add(message);
                return result;
              });
              _visibleMessages = allMessages;
              _markLatestRead(allMessages, conversationId);
              return ListView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(8, 16, 8, 12),
                children: allMessages
                    .map((message) => Align(
                          alignment: message.mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: GestureDetector(
                            onTap: _selectedMessageIds.isEmpty
                                ? null
                                : () => setState(() {
                                      if (!_selectedMessageIds
                                          .remove(message.id)) {
                                        _selectedMessageIds.add(message.id);
                                      }
                                    }),
                            onLongPress: () {
                              if (_selectedMessageIds.isNotEmpty) {
                                setState(
                                    () => _selectedMessageIds.add(message.id));
                              } else {
                                _showMessageActions(conversationId, message);
                              }
                            },
                            child: _MessageBubble(
                                message: message,
                                repository: widget.repository,
                                conversationId: conversationId,
                                contactsFuture: _contactsFuture),
                          ),
                        ))
                    .toList(),
              );
            },
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 10),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.alternate_email),
                  tooltip: '提及成员',
                  onPressed: _sendingFile ? null : _pickMention,
                ),
                IconButton(
                  icon: const Icon(Icons.attach_file),
                  tooltip: '发送文件',
                  onPressed: _sendingFile
                      ? null
                      : () => _pickAndSendFile(conversationId),
                ),
                IconButton(
                  icon: Icon(_recording ? Icons.stop : Icons.mic_none),
                  tooltip: _recording ? '停止并发送语音' : '录制语音',
                  color:
                      _recording ? Theme.of(context).colorScheme.error : null,
                  onPressed:
                      _sendingFile ? null : () => _toggleVoice(conversationId),
                ),
                Expanded(
                    child: TextField(
                        controller: _controller,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.newline,
                        decoration: const InputDecoration(
                            hintText: '输入消息…',
                            prefixIcon: Icon(Icons.emoji_emotions_outlined),
                            isDense: true))),
                const SizedBox(width: 6),
                IconButton.filled(
                  icon: const Icon(Icons.send_rounded),
                  style: IconButton.styleFrom(
                      minimumSize: const Size(46, 46),
                      shape: const CircleBorder()),
                  tooltip: '发送',
                  onPressed: () async {
                    final text = _controller.text.trim();
                    if (text.isEmpty) return;
                    try {
                      await widget.repository.sendMessage(conversationId, text);
                      _controller.clear();
                      final key = _draftKey;
                      if (key != null) {
                        final prefs = await SharedPreferences.getInstance();
                        await prefs.remove(key);
                      }
                      setState(() {});
                    } catch (error) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('发送消息失败：$error')));
                      }
                    }
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _copySelected() async {
    final text = _visibleMessages
        .where((message) => _selectedMessageIds.contains(message.id))
        .map((message) => message.text)
        .join('\n');
    if (text.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('已复制')));
    }
  }

  Future<void> _revokeSelected(String conversationId) async {
    final selected = _visibleMessages
        .where((message) =>
            _selectedMessageIds.contains(message.id) && message.mine)
        .toList();
    for (final message in selected) {
      await widget.repository.revokeMessage(conversationId, message.id);
    }
    if (mounted) setState(_selectedMessageIds.clear);
  }

  Future<void> _pickMention() async {
    final contacts = await (_contactsFuture ??= widget.repository.contacts());
    if (!mounted) return;
    final selected = await showModalBottomSheet<Contact>(
        context: context,
        showDragHandle: true,
        builder: (context) => SafeArea(
              child: ListView(
                shrinkWrap: true,
                children: [
                  ListTile(
                    leading: const Icon(Icons.campaign_outlined),
                    title: const Text('所有人'),
                    onTap: () => Navigator.pop(
                        context, const Contact(id: 'all', name: '所有人')),
                  ),
                  ...contacts.map((contact) => ListTile(
                        leading: CircleAvatar(
                            child: Text(contact.name.isEmpty
                                ? '?'
                                : contact.name.substring(0, 1))),
                        title: Text(contact.name),
                        subtitle: Text(contact.online ? '在线' : '离线'),
                        onTap: () => Navigator.pop(context, contact),
                      )),
                ],
              ),
            ));
    if (selected == null || !mounted) return;
    final token = selected.id == 'all'
        ? '{(@user/all)}'
        : '{(@${selected.type}/${selected.id})}';
    final value = _controller.value;
    final text = value.text;
    final start = value.selection.isValid ? value.selection.start : text.length;
    final end = value.selection.isValid ? value.selection.end : start;
    final next = text.replaceRange(start, end, '$token ');
    _controller.value = TextEditingValue(
        text: next,
        selection: TextSelection.collapsed(offset: start + token.length + 1));
  }

  Future<void> _pickAndSendFile(String conversationId) async {
    final result = await FilePicker.pickFiles(withData: false);
    if (!mounted || result == null || result.files.single.path == null) {
      if (mounted && result != null) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('当前平台无法读取所选文件')));
      }
      return;
    }
    final file = result.files.single;
    if (file.size > 200 * 1024 * 1024) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('文件不能超过 200MiB')));
      return;
    }
    setState(() => _sendingFile = true);
    try {
      final upload = AttachmentUpload(
          path: file.path!,
          name: file.name,
          mimeType: _mimeType(file.extension));
      if (upload.mimeType.startsWith('image/')) {
        await widget.repository.sendImage(conversationId, upload);
      } else if (upload.mimeType.startsWith('audio/')) {
        await widget.repository.sendVoice(conversationId, upload);
      } else {
        await widget.repository.sendFile(conversationId, upload);
      }
      if (mounted) setState(() => _messagesFuture = _loadMessages());
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('发送附件失败：$error')));
      }
    } finally {
      if (mounted) setState(() => _sendingFile = false);
    }
  }

  String _mimeType(String? extension) {
    switch (extension?.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'm4a':
        return 'audio/mp4';
      case 'ogg':
        return 'audio/ogg';
      case 'flac':
        return 'audio/flac';
      case 'mp4':
        return 'video/mp4';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  Future<void> _confirmRevoke(
      String conversationId, ChatMessage message) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('撤回消息'),
        content: const Text('确定撤回这条消息吗？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('撤回')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await widget.repository.revokeMessage(conversationId, message.id);
    if (mounted) setState(() {});
  }

  Future<void> _showMessageActions(
      String conversationId, ChatMessage message) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(children: [
          const ListTile(title: Text('表情回应')),
          Wrap(
            children: ['👍', '❤️', '😂', '🎉', '🤔', '👏']
                .map((emoji) => IconButton(
                      icon: Text(emoji, style: const TextStyle(fontSize: 24)),
                      tooltip: emoji,
                      onPressed: () =>
                          Navigator.pop(context, 'reaction:$emoji'),
                    ))
                .toList(),
          ),
          if (message.mine)
            ListTile(
              leading: const Icon(Icons.undo),
              title: const Text('撤回消息'),
              onTap: () => Navigator.pop(context, 'revoke'),
            ),
          ListTile(
              leading: const Icon(Icons.checklist),
              title: const Text('多选'),
              onTap: () => Navigator.pop(context, 'select')),
          ListTile(
              leading: const Icon(Icons.forum_outlined),
              title: const Text('创建话题'),
              onTap: () => Navigator.pop(context, 'topic')),
          ListTile(
              leading: const Icon(Icons.forward_outlined),
              title: const Text('转发消息'),
              onTap: () => Navigator.pop(context, 'forward')),
        ]),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'select') {
      if (mounted) setState(() => _selectedMessageIds.add(message.id));
    } else if (action == 'revoke') {
      await _confirmRevoke(conversationId, message);
    } else if (action == 'topic') {
      await widget.repository.createTopic(conversationId, message.id);
    } else if (action == 'forward') {
      final controller = TextEditingController();
      final target = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('转发到会话'),
                  content: TextField(
                      controller: controller,
                      autofocus: true,
                      decoration: const InputDecoration(labelText: '目标会话 ID')),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () =>
                            Navigator.pop(context, controller.text.trim()),
                        child: const Text('转发'))
                  ]));
      controller.dispose();
      if (target != null && target.isNotEmpty && mounted) {
        await widget.repository
            .forwardMessage(conversationId, message.id, target);
      }
    } else if (action.startsWith('reaction:')) {
      await widget.repository.setReaction(conversationId, message.id,
          text: action.substring('reaction:'.length), reacted: true);
    }
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble(
      {required this.message,
      required this.repository,
      required this.conversationId,
      this.contactsFuture});
  final ChatMessage message;
  final MagicChatRepository repository;
  final String conversationId;
  final Future<List<Contact>>? contactsFuture;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final mine = message.mine;
    final prefix = switch (message.contentType) {
      'image' => Icons.image_outlined,
      'file' => Icons.attach_file,
      'voice' => Icons.mic_none,
      'choice' => Icons.checklist,
      'object' => Icons.view_agenda_outlined,
      'chart' => Icons.bar_chart,
      _ => null,
    };
    final options = message.rawBody['options'];
    return Container(
      margin: EdgeInsets.only(
          left: mine ? 56 : 12, right: mine ? 12 : 56, bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: mine ? colors.primary : colors.surfaceContainerHighest,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine ? 18 : 4),
          bottomRight: Radius.circular(mine ? 4 : 18),
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (!mine)
          Text(message.author,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: colors.primary, fontWeight: FontWeight.w600)),
        Row(mainAxisSize: MainAxisSize.min, children: [
          if (prefix != null) Icon(prefix, size: 18),
          if (prefix != null) const SizedBox(width: 6),
          Flexible(
              child: message.contentType == 'markdown'
                  ? MarkdownBody(
                      data: message.text,
                      styleSheet: MarkdownStyleSheet.fromTheme(
                              Theme.of(context))
                          .copyWith(
                              p: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(
                                      color: mine ? colors.onPrimary : null),
                              a: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(
                                      color: mine
                                          ? colors.onPrimary
                                          : colors.primary,
                                      decoration: TextDecoration.underline)),
                      onTapLink: (text, href, title) {
                        final uri = href == null ? null : Uri.tryParse(href);
                        if (uri != null) {
                          launchUrl(uri, mode: LaunchMode.externalApplication);
                        }
                      })
                  : FutureBuilder<List<Contact>>(
                      future: contactsFuture,
                      builder: (context, snapshot) {
                        final contacts = snapshot.data ?? const <Contact>[];
                        return Text(
                            formatMentionText(message.text,
                                contacts.map((c) => (id: c.id, name: c.name))),
                            style: TextStyle(
                                color: mine ? colors.onPrimary : null));
                      })),
        ]),
        if ((message.contentType == 'image' ||
                message.contentType == 'voice' ||
                message.contentType == 'file') &&
            message.rawBody['file_id'] is String)
          FutureBuilder<Uri?>(
            future:
                repository.attachmentUrl(message.rawBody['file_id'] as String),
            builder: (context, snapshot) {
              final uri = snapshot.data;
              if (uri == null) return const SizedBox.shrink();
              if (message.contentType == 'image') {
                return Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: GestureDetector(
                    onTap: () => showDialog<void>(
                      context: context,
                      builder: (context) => Dialog(
                        child: InteractiveViewer(
                            child: Image.network(uri.toString(),
                                fit: BoxFit.contain)),
                      ),
                    ),
                    child: ConstrainedBox(
                        constraints:
                            const BoxConstraints(maxWidth: 320, maxHeight: 240),
                        child:
                            Image.network(uri.toString(), fit: BoxFit.contain)),
                  ),
                );
              }
              return TextButton.icon(
                  onPressed: () =>
                      launchUrl(uri, mode: LaunchMode.externalApplication),
                  icon: Icon(message.contentType == 'voice'
                      ? Icons.play_circle_outline
                      : Icons.download_outlined),
                  label:
                      Text(message.contentType == 'voice' ? '播放语音' : '打开附件'));
            },
          ),
        if (message.contentType == 'choice' && options is List)
          ...options.whereType<Map<String, dynamic>>().map((option) {
            final id = option['id'];
            final label = option['label'] ?? option['text'];
            return id is String && label is String
                ? TextButton(
                    onPressed: () => repository
                        .submitChoice(conversationId, message.id, [id]),
                    child: Align(
                        alignment: Alignment.centerLeft, child: Text(label)),
                  )
                : const SizedBox.shrink();
          }),
        if (message.contentType == 'chart')
          _ChartPreview(body: message.rawBody),
        if (message.contentType == 'object' || message.contentType == 'chart')
          ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text(message.contentType == 'chart' ? '查看图表数据' : '查看对象详情'),
              children: [
                Align(
                    alignment: Alignment.centerLeft,
                    child: SelectableText(
                        const JsonEncoder.withIndent('  ')
                            .convert(message.rawBody),
                        style: Theme.of(context).textTheme.bodySmall))
              ]),
      ]),
    );
  }
}

class _ChartPreview extends StatelessWidget {
  const _ChartPreview({required this.body});
  final Map<String, dynamic> body;

  @override
  Widget build(BuildContext context) {
    final data = body['data'];
    if (data is! Map<String, dynamic>) return const SizedBox.shrink();
    if (body['chart_type'] == 'line') return _ChartLine(data: data);
    if (body['chart_type'] == 'radar') return _ChartRadar(data: data);
    final labels = data['labels'];
    final series = data['series'];
    if (labels is! List || series is! List || labels.isEmpty) {
      final items = data['items'];
      if (items is! List) return const SizedBox.shrink();
      return _ChartBars(items: items);
    }
    final typedSeries = series.whereType<Map<String, dynamic>>().toList();
    final first = typedSeries.isEmpty ? null : typedSeries.first;
    final values = first?['values'];
    if (values is! List) return const SizedBox.shrink();
    return _ChartBars(items: [
      for (var i = 0; i < labels.length && i < values.length; i++)
        {'name': '${labels[i]}', 'value': values[i]}
    ]);
  }
}

class _ChartLine extends StatelessWidget {
  const _ChartLine({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final labels = data['labels'];
    final series = data['series'];
    if (labels is! List || series is! List || labels.length < 2) {
      return const SizedBox.shrink();
    }
    final values = series
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final raw = item['values'];
          return raw is List
              ? raw.map((value) => (value as num?)?.toDouble()).toList()
              : <double?>[];
        })
        .where((values) => values.length >= labels.length)
        .toList();
    if (values.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 180,
      width: double.infinity,
      child: CustomPaint(painter: _LineChartPainter(values)),
    );
  }
}

class _ChartRadar extends StatelessWidget {
  const _ChartRadar({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final axes = data['axes'];
    final series = data['series'];
    if (axes is! List || axes.length < 3 || series is! List) {
      return const SizedBox.shrink();
    }
    final maxes = axes
        .whereType<Map<String, dynamic>>()
        .map((axis) => (axis['max'] as num?)?.toDouble() ?? 1)
        .toList();
    final values = series
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final raw = item['values'];
          return raw is List
              ? raw.map((value) => (value as num?)?.toDouble() ?? 0).toList()
              : <double>[];
        })
        .where((item) => item.length == maxes.length)
        .toList();
    if (maxes.length != axes.length || values.isEmpty) {
      return const SizedBox.shrink();
    }
    return SizedBox(
        height: 220,
        width: double.infinity,
        child: CustomPaint(painter: _RadarChartPainter(maxes, values)));
  }
}

class _RadarChartPainter extends CustomPainter {
  _RadarChartPainter(this.maxes, this.series);
  final List<double> maxes;
  final List<List<double>> series;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.shortestSide * .38;
    final count = maxes.length;
    Offset point(double r, int index) {
      final angle =
          -3.141592653589793 / 2 + index * 2 * 3.141592653589793 / count;
      return center + Offset(r * cos(angle), r * sin(angle));
    }

    final grid = Paint()
      ..color = const Color(0x44333333)
      ..style = PaintingStyle.stroke;
    for (var level = 1; level <= 4; level++) {
      final path = Path()
        ..moveTo(
            point(radius * level / 4, 0).dx, point(radius * level / 4, 0).dy);
      for (var i = 1; i < count; i++) {
        final p = point(radius * level / 4, i);
        path.lineTo(p.dx, p.dy);
      }
      path.close();
      canvas.drawPath(path, grid);
    }
    for (var i = 0; i < count; i++)
      canvas.drawLine(center, point(radius, i), grid);
    final colors = [Colors.blue, Colors.orange, Colors.green, Colors.purple];
    for (var s = 0; s < series.length; s++) {
      final path = Path();
      for (var i = 0; i < count; i++) {
        final p = point(radius * (series[s][i] / maxes[i]).clamp(0, 1), i);
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      path.close();
      final color = colors[s % colors.length];
      canvas.drawPath(path, Paint()..color = color.withValues(alpha: .18));
      canvas.drawPath(
          path,
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2);
    }
  }

  @override
  bool shouldRepaint(covariant _RadarChartPainter oldDelegate) => true;
}

class _LineChartPainter extends CustomPainter {
  _LineChartPainter(this.series);
  final List<List<double?>> series;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTWH(8, 8, size.width - 16, size.height - 16);
    final values = series.expand((item) => item).whereType<double>().toList();
    if (values.isEmpty) return;
    final min = values.reduce((a, b) => a < b ? a : b);
    final max = values.reduce((a, b) => a > b ? a : b);
    final range = max == min ? 1 : max - min;
    final grid = Paint()
      ..color = const Color(0x33222222)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = plot.top + plot.height * i / 3;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
    }
    final colors = [Colors.blue, Colors.orange, Colors.green, Colors.purple];
    for (var s = 0; s < series.length; s++) {
      final points = <Offset>[];
      final item = series[s];
      for (var i = 0; i < item.length; i++) {
        final value = item[i];
        if (value == null) continue;
        points.add(Offset(plot.left + plot.width * i / (item.length - 1),
            plot.bottom - (value - min) / range * plot.height));
      }
      if (points.length < 2) continue;
      final path = Path()..moveTo(points.first.dx, points.first.dy);
      for (final point in points.skip(1)) path.lineTo(point.dx, point.dy);
      canvas.drawPath(
          path,
          Paint()
            ..color = colors[s % colors.length]
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2.5);
    }
  }

  @override
  bool shouldRepaint(covariant _LineChartPainter oldDelegate) =>
      oldDelegate.series != series;
}

class _ChartBars extends StatelessWidget {
  const _ChartBars({required this.items});
  final List<Object?> items;

  @override
  Widget build(BuildContext context) {
    final values = items.map((item) {
      if (item is Map<String, dynamic>)
        return (item['value'] as num?)?.toDouble() ?? 0;
      return 0.0;
    }).toList();
    final max = values.fold<double>(
        0, (current, value) => value > current ? value : current);
    if (max <= 0) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < items.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              SizedBox(
                  width: 90,
                  child:
                      Text(_label(items[i]), overflow: TextOverflow.ellipsis)),
              Expanded(
                  child: LinearProgressIndicator(
                      value: values[i] / max, minHeight: 10)),
              const SizedBox(width: 8),
              Text(_format(values[i]))
            ]),
          )
      ],
    );
  }

  String _label(Object? item) => item is Map<String, dynamic>
      ? '${item['name'] ?? item['label'] ?? ''}'
      : '';
  String _format(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}

class DocumentEditorPage extends StatefulWidget {
  const DocumentEditorPage(
      {required this.repository, required this.document, super.key});
  final MagicChatRepository repository;
  final ProjectDocument document;

  @override
  State<DocumentEditorPage> createState() => _DocumentEditorPageState();
}

class _DocumentEditorPageState extends State<DocumentEditorPage> {
  late final TextEditingController _title =
      TextEditingController(text: widget.document.title);
  late final TextEditingController _body = TextEditingController();
  bool _preview = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadDraft();
  }

  Future<void> _loadDraft() async {
    final prefs = await SharedPreferences.getInstance();
    final draft =
        prefs.getString('magicchat.document.${widget.document.id}.draft');
    if (draft != null && mounted) {
      _body.text = draft;
      setState(() {});
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty || _saving) return;
    setState(() => _saving = true);
    try {
      await widget.repository.updateDocument(widget.document.id, title: title);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          'magicchat.document.${widget.document.id}.draft', _body.text);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('文档标题已保存')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('保存失败：$error')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
        title: TextField(
            controller: _title,
            decoration: const InputDecoration(
                border: InputBorder.none, hintText: '文档标题')),
        actions: [
          IconButton(
              tooltip: _preview ? '编辑' : '预览',
              onPressed: () => setState(() => _preview = !_preview),
              icon: Icon(
                  _preview ? Icons.edit_outlined : Icons.preview_outlined)),
          IconButton(
              tooltip: '保存标题',
              onPressed: _saving ? null : _save,
              icon: const Icon(Icons.save_outlined))
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: _preview
            ? SingleChildScrollView(
                child: SelectableText(_body.text.isEmpty ? '暂无内容' : _body.text,
                    style: Theme.of(context).textTheme.bodyLarge))
            : TextField(
                controller: _body,
                expands: true,
                maxLines: null,
                minLines: null,
                textAlignVertical: TextAlignVertical.top,
                decoration: const InputDecoration(
                    hintText: '输入 Markdown 或文档内容…',
                    border: OutlineInputBorder()),
                onChanged: (_) => setState(() {})),
      ),
      bottomNavigationBar: SafeArea(
          child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Align(
                  alignment: Alignment.centerRight,
                  child: Text('${_body.text.length} 字',
                      style: Theme.of(context).textTheme.bodySmall)))));
}

class ContactsPage extends StatefulWidget {
  const ContactsPage(
      {required this.repository, this.onOpenConversation, super.key});
  final MagicChatRepository repository;
  final ValueChanged<String>? onOpenConversation;
  @override
  State<ContactsPage> createState() => _ContactsPageState();
}

class _ContactsPageState extends State<ContactsPage> {
  final _searchController = TextEditingController();
  Future<List<Contact>>? _contactsFuture;
  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => setState(() => _contactsFuture =
      widget.repository.contacts(keyword: _searchController.text.trim()));
  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
                controller: _searchController,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _load(),
                decoration: InputDecoration(
                    hintText: '搜索联系人、应用或群组',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: IconButton(
                        onPressed: _load, icon: const Icon(Icons.refresh))))),
        Expanded(
            child: FutureBuilder<List<Contact>>(
                future: _contactsFuture,
                builder: (context, s) => s.hasData
                    ? ListView(
                        children: s.data!
                            .map((c) => ListTile(
                                leading: CircleAvatar(
                                    child: Text(c.name.isEmpty
                                        ? '?'
                                        : c.name.substring(0, 1))),
                                title: Text(c.name),
                                subtitle: Text(c.online ? '在线' : '离线'),
                                trailing: Icon(
                                    c.online
                                        ? Icons.circle
                                        : Icons.circle_outlined,
                                    color:
                                        c.online ? Colors.green : Colors.grey,
                                    size: 12),
                                onTap: () async {
                                  final conversation = c.type == 'app'
                                      ? await widget.repository
                                          .createAppConversation(c.id)
                                      : c.type == 'user'
                                          ? await widget.repository
                                              .createDirectConversation(c.id)
                                          : ChatConversation(
                                              id: c.id, title: c.name);
                                  if (context.mounted)
                                    widget.onOpenConversation
                                        ?.call(conversation.id);
                                }))
                            .toList())
                    : const Center(child: CircularProgressIndicator())))
      ]);
}

class ProjectsPage extends StatelessWidget {
  const ProjectsPage({required this.repository, super.key});
  final MagicChatRepository repository;
  @override
  Widget build(BuildContext context) => Stack(children: [
        FutureBuilder<List<Project>>(
            future: repository.projects(),
            builder: (context, snapshot) {
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              return ListView(
                children: snapshot.data!
                    .map((project) => ListTile(
                          leading: const Icon(Icons.folder),
                          title: Text(project.name),
                          subtitle: Text('${project.taskCount} 个任务'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _showTasks(context, project),
                          onLongPress: () => _projectActions(context, project),
                        ))
                    .toList(),
              );
            }),
        Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
                onPressed: () => _createProject(context),
                child: const Icon(Icons.create_new_folder),
                tooltip: '新建项目')),
      ]);

  Future<void> _projectActions(BuildContext context, Project project) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => SafeArea(
                child: Wrap(children: [
              ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: const Text('编辑项目'),
                  onTap: () => Navigator.pop(context, 'edit')),
              ListTile(
                  leading: const Icon(Icons.delete_outline),
                  title: const Text('删除项目'),
                  onTap: () => Navigator.pop(context, 'delete')),
            ])));
    if (!context.mounted || action == null) return;
    if (action == 'delete') {
      final ok = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('删除项目？'),
                  content: Text('将删除“${project.name}”及其任务。'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('删除'))
                  ]));
      if (ok == true) await repository.deleteProject(project.id);
    } else {
      final controller = TextEditingController(text: project.name);
      final name = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('编辑项目'),
                  content: TextField(controller: controller, autofocus: true),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () =>
                            Navigator.pop(context, controller.text.trim()),
                        child: const Text('保存'))
                  ]));
      controller.dispose();
      if (name != null && name.isNotEmpty && context.mounted)
        await repository.updateProject(project.id, name: name);
    }
  }

  Future<void> _createProject(BuildContext context) async {
    final nameController = TextEditingController();
    final descriptionController = TextEditingController();
    final result = await showDialog<({String name, String description})>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('新建项目'),
              content: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(
                    controller: nameController,
                    autofocus: true,
                    decoration: const InputDecoration(labelText: '项目名称')),
                TextField(
                    controller: descriptionController,
                    decoration: const InputDecoration(labelText: '描述')),
              ]),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(dialogContext, (
                          name: nameController.text.trim(),
                          description: descriptionController.text.trim()
                        )),
                    child: const Text('创建')),
              ],
            ));
    nameController.dispose();
    descriptionController.dispose();
    if (result == null || result.name.isEmpty || !context.mounted) return;
    try {
      await repository.createProject(result.name,
          description: result.description);
      if (context.mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('项目已创建，请刷新列表')));
    } catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('创建失败：$error')));
    }
  }

  Future<void> _showTasks(BuildContext context, Project project) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .7,
          child: FutureBuilder<List<ProjectTask>>(
            future: repository.tasks(project.id),
            builder: (context, snapshot) {
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              return DefaultTabController(
                length: 5,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                    child: Row(children: [
                      Expanded(
                          child: Text(project.name,
                              style: Theme.of(context).textTheme.titleLarge)),
                      IconButton(
                          onPressed: () => _createTask(context, project),
                          icon: const Icon(Icons.add),
                          tooltip: '新建任务'),
                    ]),
                  ),
                  const TabBar(tabs: [
                    Tab(text: '列表'),
                    Tab(text: '看板'),
                    Tab(text: '日历'),
                    Tab(text: '甘特'),
                    Tab(text: '文档')
                  ]),
                  Expanded(
                      child: TabBarView(children: [
                    ListView(
                        padding: const EdgeInsets.all(16),
                        children: snapshot.data!
                            .map((task) => _taskTile(context, project, task))
                            .toList()),
                    _taskBoard(context, project, snapshot.data!),
                    _taskCalendar(context, project, snapshot.data!),
                    _taskGantt(context, project, snapshot.data!),
                    _documentsView(context, project),
                  ])),
                ]),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _taskTile(BuildContext context, Project project, ProjectTask task) =>
      ListTile(
        leading: Icon(task.status == 'done'
            ? Icons.check_circle
            : Icons.radio_button_unchecked),
        title: Text(task.title),
        subtitle: Text('状态：${task.status} · 优先级 ${task.priority}'),
        trailing: PopupMenuButton<String>(
            onSelected: (action) async {
              if (!context.mounted) return;
              if (action == 'edit') {
                await _editTask(context, project, task);
                return;
              }
              if (action != 'delete') return;
              final ok = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                        title: const Text('删除任务？'),
                        content: Text('将删除“${task.title}”。'),
                        actions: [
                          TextButton(
                              onPressed: () => Navigator.pop(context, false),
                              child: const Text('取消')),
                          FilledButton(
                              onPressed: () => Navigator.pop(context, true),
                              child: const Text('删除'))
                        ],
                      ));
              if (ok == true) await repository.deleteTask(project.id, task.id);
            },
            itemBuilder: (context) => const [
                  PopupMenuItem(value: 'edit', child: Text('编辑任务')),
                  PopupMenuItem(value: 'delete', child: Text('删除任务'))
                ]),
        onTap: () => _cycleTaskStatus(context, project, task),
        onLongPress: () => _addComment(context, project, task),
      );

  Future<void> _editTask(
      BuildContext context, Project project, ProjectTask task) async {
    final titleController = TextEditingController(text: task.title);
    final descriptionController = TextEditingController(text: task.description);
    final startController = TextEditingController(text: task.startDate ?? '');
    final dueController = TextEditingController(text: task.dueDate ?? '');
    final labelsController =
        TextEditingController(text: task.labels.join(', '));
    final assigneeController =
        TextEditingController(text: task.assigneeUserId ?? '');
    final reminderController =
        TextEditingController(text: task.reminder?['at']?.toString() ?? '');
    var status = task.status;
    var priority = task.priority;
    var reminderMode = task.reminder?['mode'] as String? ?? 'once';
    var reminderFrequency = task.reminder?['frequency'] as String? ?? 'daily';
    final result = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
              builder: (dialogContext, setDialogState) => AlertDialog(
                title: const Text('编辑任务'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: titleController,
                      decoration: const InputDecoration(labelText: '标题')),
                  TextField(
                      controller: descriptionController,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(labelText: '描述')),
                  DropdownButtonFormField<String>(
                      value: status,
                      decoration: const InputDecoration(labelText: '状态'),
                      items: const [
                        DropdownMenuItem(value: 'todo', child: Text('待处理')),
                        DropdownMenuItem(
                            value: 'in_progress', child: Text('进行中')),
                        DropdownMenuItem(value: 'done', child: Text('已完成'))
                      ],
                      onChanged: (value) {
                        if (value != null) setDialogState(() => status = value);
                      }),
                  DropdownButtonFormField<int>(
                      value: priority,
                      decoration: const InputDecoration(labelText: '优先级'),
                      items: const [
                        DropdownMenuItem(value: 1, child: Text('高')),
                        DropdownMenuItem(value: 2, child: Text('中')),
                        DropdownMenuItem(value: 3, child: Text('低'))
                      ],
                      onChanged: (value) {
                        if (value != null)
                          setDialogState(() => priority = value);
                      }),
                  TextField(
                      controller: startController,
                      decoration:
                          const InputDecoration(labelText: '开始日期（YYYY-MM-DD）')),
                  TextField(
                      controller: dueController,
                      decoration:
                          const InputDecoration(labelText: '截止日期（YYYY-MM-DD）')),
                  TextField(
                      controller: labelsController,
                      decoration: const InputDecoration(labelText: '标签（逗号分隔）')),
                  TextField(
                      controller: assigneeController,
                      decoration: const InputDecoration(labelText: '负责人用户 ID')),
                  TextField(
                      controller: reminderController,
                      decoration: const InputDecoration(
                          labelText: '一次性提醒时间（ISO-8601，可选）')),
                  DropdownButtonFormField<String>(
                      value: reminderMode,
                      decoration: const InputDecoration(labelText: '提醒模式'),
                      items: const [
                        DropdownMenuItem(value: 'once', child: Text('一次性')),
                        DropdownMenuItem(value: 'recurring', child: Text('周期性'))
                      ],
                      onChanged: (value) {
                        if (value != null)
                          setDialogState(() => reminderMode = value);
                      }),
                  if (reminderMode == 'recurring')
                    DropdownButtonFormField<String>(
                        value: reminderFrequency,
                        decoration: const InputDecoration(labelText: '重复频率'),
                        items: const [
                          DropdownMenuItem(value: 'daily', child: Text('每天')),
                          DropdownMenuItem(value: 'weekly', child: Text('每周')),
                          DropdownMenuItem(value: 'monthly', child: Text('每月'))
                        ],
                        onChanged: (value) {
                          if (value != null)
                            setDialogState(() => reminderFrequency = value);
                        }),
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('取消')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('保存'))
                ],
              ),
            ));
    if (result == true && context.mounted) {
      await repository.updateTask(project.id, task.id,
          title: titleController.text.trim(),
          description: descriptionController.text.trim(),
          status: status,
          priority: priority,
          startDate: startController.text.trim().isEmpty
              ? null
              : startController.text.trim(),
          dueDate: dueController.text.trim().isEmpty
              ? null
              : dueController.text.trim(),
          labels: labelsController.text
              .split(',')
              .map((value) => value.trim())
              .where((value) => value.isNotEmpty)
              .toList(),
          assigneeUserId: assigneeController.text.trim().isEmpty
              ? null
              : assigneeController.text.trim(),
          reminder: reminderController.text.trim().isEmpty
              ? null
              : {
                  'mode': reminderMode,
                  'timezone': 'Asia/Shanghai',
                  if (reminderMode == 'once')
                    'at': reminderController.text.trim(),
                  if (reminderMode == 'recurring')
                    'frequency': reminderFrequency
                });
    }
    titleController.dispose();
    descriptionController.dispose();
    startController.dispose();
    dueController.dispose();
    labelsController.dispose();
    assigneeController.dispose();
    reminderController.dispose();
  }

  Widget _documentsView(BuildContext context, Project project) =>
      FutureBuilder<List<ProjectDocument>>(
          future: repository.documents(project.id),
          builder: (context, snapshot) {
            if (!snapshot.hasData)
              return const Center(child: CircularProgressIndicator());
            return Stack(children: [
              ListView(
                  padding: const EdgeInsets.all(16),
                  children: snapshot.data!
                      .map((document) => ListTile(
                            leading: Icon(document.kind == 'folder'
                                ? Icons.folder_outlined
                                : Icons.description_outlined),
                            title: Text(document.title),
                            subtitle:
                                Text(document.kind == 'folder' ? '目录' : '文档'),
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => DocumentEditorPage(
                                        repository: repository,
                                        document: document))),
                            onLongPress: () =>
                                _documentActions(context, document),
                          ))
                      .toList()),
              Positioned(
                  right: 16,
                  bottom: 16,
                  child: FloatingActionButton.small(
                      onPressed: () => _createDocument(context, project),
                      child: const Icon(Icons.note_add_outlined),
                      tooltip: '新建文档')),
            ]);
          });

  Future<void> _createDocument(BuildContext context, Project project) async {
    final controller = TextEditingController();
    var kind = 'document';
    final result = await showDialog<({String title, String kind})>(
        context: context,
        builder: (context) => StatefulBuilder(
            builder: (context, setState) => AlertDialog(
                    title: const Text('新建文档'),
                    content: Column(mainAxisSize: MainAxisSize.min, children: [
                      TextField(
                          controller: controller,
                          autofocus: true,
                          decoration: const InputDecoration(labelText: '名称')),
                      DropdownButtonFormField<String>(
                          value: kind,
                          decoration: const InputDecoration(labelText: '类型'),
                          items: const [
                            DropdownMenuItem(
                                value: 'document', child: Text('文档')),
                            DropdownMenuItem(value: 'folder', child: Text('目录'))
                          ],
                          onChanged: (value) {
                            if (value != null) setState(() => kind = value);
                          })
                    ]),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('取消')),
                      FilledButton(
                          onPressed: () => Navigator.pop(context,
                              (title: controller.text.trim(), kind: kind)),
                          child: const Text('创建'))
                    ])));
    controller.dispose();
    if (result == null || result.title.isEmpty || !context.mounted) return;
    await repository.createDocument(project.id, result.title,
        kind: result.kind);
    if (context.mounted)
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('文档已创建，请重新打开项目查看')));
  }

  Future<void> _documentActions(
      BuildContext context, ProjectDocument document) async {
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => SafeArea(
                child: Wrap(children: [
              ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: const Text('重命名'),
                  onTap: () => Navigator.pop(context, 'rename')),
              ListTile(
                  leading: const Icon(Icons.delete_outline),
                  title: const Text('删除'),
                  onTap: () => Navigator.pop(context, 'delete')),
              ListTile(
                  leading: const Icon(Icons.drive_file_move_outlined),
                  title: const Text('移动到目录'),
                  onTap: () => Navigator.pop(context, 'move')),
            ])));
    if (!context.mounted || action == null) return;
    if (action == 'delete') {
      final ok = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('删除文档？'),
                  content: Text('将删除“${document.title}”。'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('删除'))
                  ]));
      if (ok == true) await repository.deleteDocument(document.id);
    } else if (action == 'move') {
      final documents = await repository.documents(document.projectId);
      final folders = documents
          .where((item) => item.kind == 'folder' && item.id != document.id)
          .toList();
      final parentId = await showDialog<String>(
          context: context,
          builder: (dialogContext) => SimpleDialog(
                title: const Text('选择目标目录'),
                children: [
                  SimpleDialogOption(
                      onPressed: () => Navigator.pop(dialogContext, ''),
                      child: const Text('项目根目录')),
                  ...folders.map((folder) => SimpleDialogOption(
                      onPressed: () => Navigator.pop(dialogContext, folder.id),
                      child: Text(folder.title))),
                ],
              ));
      if (parentId != null && context.mounted) {
        await repository.moveDocument(document.id,
            parentId: parentId.isEmpty ? null : parentId, index: 0);
      }
    } else {
      final controller = TextEditingController(text: document.title);
      final title = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('重命名文档'),
                  content: TextField(controller: controller, autofocus: true),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('取消')),
                    FilledButton(
                        onPressed: () =>
                            Navigator.pop(context, controller.text.trim()),
                        child: const Text('保存'))
                  ]));
      controller.dispose();
      if (title != null && title.isNotEmpty && context.mounted)
        await repository.updateDocument(document.id, title: title);
    }
  }

  Widget _taskBoard(
      BuildContext context, Project project, List<ProjectTask> tasks) {
    const statuses = ['todo', 'in_progress', 'done'];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(12),
      child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: statuses.map((status) {
            final items = tasks.where((task) => task.status == status).toList();
            return SizedBox(
                width: 230,
                child: Card(
                    child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(status,
                                  style:
                                      Theme.of(context).textTheme.titleMedium),
                              const Divider(),
                              ...items.map(
                                  (task) => _taskTile(context, project, task)),
                            ]))));
          }).toList()),
    );
  }

  Widget _taskCalendar(
      BuildContext context, Project project, List<ProjectTask> tasks) {
    final dated = [...tasks]..sort((a, b) =>
        (a.dueDate ?? a.startDate ?? '9999')
            .compareTo(b.dueDate ?? b.startDate ?? '9999'));
    return ListView(
      padding: const EdgeInsets.all(16),
      children: dated
          .map((task) => ListTile(
                leading: const Icon(Icons.event_outlined),
                title: Text(task.title),
                subtitle: Text(
                    '开始：${task.startDate ?? '未设置'} · 截止：${task.dueDate ?? '未设置'}'),
                onTap: () => _cycleTaskStatus(context, project, task),
              ))
          .toList(),
    );
  }

  Widget _taskGantt(
      BuildContext context, Project project, List<ProjectTask> tasks) {
    final dated = tasks
        .where((task) => task.startDate != null || task.dueDate != null)
        .toList();
    if (dated.isEmpty) {
      return const Center(child: Text('暂无排期任务'));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('时间线（横向滚动查看）'),
        const SizedBox(height: 12),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: 720,
            child: Column(
              children: dated.map((task) {
                final start =
                    DateTime.tryParse(task.startDate ?? task.dueDate!);
                final due = DateTime.tryParse(task.dueDate ?? task.startDate!);
                final days = start != null && due != null
                    ? due.difference(start).inDays.abs() + 1
                    : 1;
                return ListTile(
                  title: Text(task.title),
                  subtitle: Text(
                      '${task.startDate ?? '未设置'} → ${task.dueDate ?? '未设置'}'),
                  trailing: SizedBox(
                      width: (days * 18).clamp(18, 360).toDouble(),
                      child: LinearProgressIndicator(
                          value: task.status == 'done'
                              ? 1
                              : task.status == 'in_progress'
                                  ? .5
                                  : .1)),
                  onTap: () => _cycleTaskStatus(context, project, task),
                );
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _cycleTaskStatus(
      BuildContext context, Project project, ProjectTask task) async {
    final next = task.status == 'todo'
        ? 'in_progress'
        : task.status == 'in_progress'
            ? 'done'
            : 'todo';
    await repository.updateTaskStatus(project.id, task.id, next);
    if (context.mounted) Navigator.pop(context);
  }

  Future<void> _createTask(BuildContext context, Project project) async {
    final controller = TextEditingController();
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('新建任务'),
        content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(labelText: '任务标题')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: const Text('创建')),
        ],
      ),
    );
    controller.dispose();
    if (title == null || title.isEmpty || !context.mounted) return;
    await repository.createTask(project.id, title);
    if (context.mounted) Navigator.pop(context);
  }

  Future<void> _addComment(
      BuildContext context, Project project, ProjectTask task) async {
    final controller = TextEditingController();
    final content = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('评论：${task.title}'),
        content: TextField(
            controller: controller,
            autofocus: true,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(labelText: '评论内容')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context), child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: const Text('发送')),
        ],
      ),
    );
    controller.dispose();
    if (content == null || content.isEmpty || !context.mounted) return;
    await repository.addTaskComment(project.id, task.id, content);
  }
}

class SettingsPage extends StatefulWidget {
  const SettingsPage(
      {required this.repository,
      required this.serverUrl,
      this.onServerChanged,
      this.onAccountSwitch,
      this.onLogout,
      this.onThemeChanged,
      this.themeMode = ThemeMode.system,
      super.key});
  final Future<void> Function()? onLogout;
  final MagicChatRepository repository;
  final String? serverUrl;
  final ValueChanged<String>? onServerChanged;
  final ValueChanged<StoredAccount>? onAccountSwitch;
  final ValueChanged<ThemeMode>? onThemeChanged;
  final ThemeMode themeMode;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  Future<CurrentUser>? _userFuture;
  bool _notificationsEnabled = true;
  @override
  void initState() {
    super.initState();
    _userFuture = widget.repository.currentUser();
    SharedPreferences.getInstance().then((prefs) {
      if (mounted)
        setState(() => _notificationsEnabled =
            prefs.getBool('magicchat.notifications.enabled') ?? true);
    });
  }

  Future<void> _setNotifications(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('magicchat.notifications.enabled', value);
    if (mounted) setState(() => _notificationsEnabled = value);
  }

  Future<void> _showStorage() async {
    final service = StorageService();
    var info = await service.inspect();
    if (!mounted) return;
    await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
              builder: (dialogContext, setDialogState) => AlertDialog(
                title: const Text('存储管理'),
                content: Text('缓存占用：${info.formatted}\n位置：${info.path}'),
                actions: [
                  TextButton(
                      onPressed: () async {
                        await service.clearCache();
                        info = await service.inspect();
                        setDialogState(() {});
                      },
                      child: const Text('清理缓存')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('关闭')),
                ],
              ),
            ));
  }

  Future<void> _checkForUpdate() async {
    try {
      final release = await const UpdateService().check();
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                title: const Text('检查更新'),
                content: Text(release == null
                    ? '当前已是最新版本（${UpdateService.currentVersion}）'
                    : '发现新版本 ${release.version}（${release.build}）'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('关闭')),
                  if (release != null)
                    FilledButton(
                        onPressed: () async {
                          await launchUrl(Uri.parse(release.url),
                              mode: LaunchMode.externalApplication);
                          if (dialogContext.mounted)
                            Navigator.pop(dialogContext);
                        },
                        child: const Text('打开下载页')),
                ],
              ));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('检查更新失败：$error')));
      }
    }
  }

  Future<void> _editNickname(CurrentUser user) async {
    final controller = TextEditingController(text: user.nickname);
    final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('修改昵称'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  maxLength: 64,
                  decoration: const InputDecoration(labelText: '昵称')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(context, controller.text.trim()),
                    child: const Text('保存'))
              ],
            ));
    controller.dispose();
    if (value == null || !mounted) return;
    try {
      setState(
          () => _userFuture = widget.repository.updateProfile(nickname: value));
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('保存失败：$error')));
    }
  }

  Future<void> _pickAvatar() async {
    final result =
        await FilePicker.pickFiles(type: FileType.image, withData: true);
    if (result == null || !mounted) return;
    final file = result.files.single;
    final bytes = file.bytes;
    if (bytes == null && file.path == null) return;
    try {
      final processed =
          bytes == null ? null : const AvatarProcessor().process(bytes);
      setState(() => _userFuture = widget.repository.uploadAvatar(
          AttachmentUpload(
              path: file.path ?? '',
              name: processed == null ? file.name : 'avatar.webp',
              mimeType: processed == null
                  ? 'image/${file.extension ?? 'webp'}'
                  : 'image/webp',
              bytes: processed)));
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('头像上传失败：$error')));
    }
  }

  Future<void> _editServer() async {
    final controller = TextEditingController(text: widget.serverUrl ?? '');
    final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('服务器配置'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                      labelText: '服务器地址',
                      hintText: 'https://chat.example.com')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(context, controller.text.trim()),
                    child: const Text('切换'))
              ],
            ));
    controller.dispose();
    if (value == null || value.isEmpty || !mounted || value == widget.serverUrl)
      return;
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('切换服务器？'),
              content: const Text('切换后需要重新登录，当前会话将被清除。'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('确认切换'))
              ],
            ));
    if (confirmed == true) widget.onServerChanged?.call(value);
  }

  Future<void> _chooseAccount() async {
    final accounts = await const SessionStore().readAccounts();
    if (!mounted) return;
    await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('账户管理'),
              content: SizedBox(
                  width: 420,
                  child: accounts.isEmpty
                      ? const Text('暂无已保存账户')
                      : ListView(
                          shrinkWrap: true,
                          children: accounts
                              .map((account) => ListTile(
                                  leading:
                                      const Icon(Icons.account_circle_outlined),
                                  title: Text(account.name.isEmpty
                                      ? account.email
                                      : account.name),
                                  subtitle: Text(
                                      account.status == 'reauth-required'
                                          ? '需要重新登录 · ${account.serverUrl}'
                                          : account.serverUrl),
                                  onTap: () {
                                    Navigator.pop(dialogContext);
                                    if (account.status == 'reauth-required') {
                                      _reauthAccount(account);
                                    } else {
                                      widget.onAccountSwitch?.call(account);
                                    }
                                  },
                                  onLongPress: () async {
                                    final remove = await showDialog<bool>(
                                        context: dialogContext,
                                        builder: (confirmContext) =>
                                            AlertDialog(
                                              title: const Text('删除已保存账户？'),
                                              content: Text(
                                                  account.email.isEmpty
                                                      ? account.serverUrl
                                                      : account.email),
                                              actions: [
                                                TextButton(
                                                    onPressed: () =>
                                                        Navigator.pop(
                                                            confirmContext,
                                                            false),
                                                    child: const Text('取消')),
                                                FilledButton(
                                                    onPressed: () =>
                                                        Navigator.pop(
                                                            confirmContext,
                                                            true),
                                                    child: const Text('删除'))
                                              ],
                                            ));
                                    if (remove == true) {
                                      await const SessionStore()
                                          .removeAccount(account.id);
                                      if (dialogContext.mounted)
                                        Navigator.pop(dialogContext);
                                    }
                                  }))
                              .toList())),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('关闭'))
              ],
            ));
  }

  Future<void> _reauthAccount(StoredAccount account) async {
    final controller = TextEditingController();
    final password = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('重新登录账户'),
              content: TextField(
                  controller: controller,
                  obscureText: true,
                  autofocus: true,
                  decoration: InputDecoration(labelText: account.email)),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, controller.text),
                    child: const Text('登录'))
              ],
            ));
    controller.dispose();
    if (password == null || password.isEmpty || !mounted) return;
    try {
      await AuthService().login(
          serverUrl: account.serverUrl,
          email: account.email,
          password: password);
      final token = await const SessionStore().readToken();
      if (token == null || !mounted) return;
      final replacement = StoredAccount(
          id: account.id,
          serverUrl: account.serverUrl,
          token: token,
          email: account.email,
          name: account.name);
      await const SessionStore().saveAccount(replacement);
      widget.onAccountSwitch?.call(replacement);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('重新登录失败：$error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListView(children: [
        FutureBuilder<CurrentUser>(
            future: _userFuture,
            builder: (context, snapshot) {
              final user = snapshot.data;
              if (user == null)
                return const ListTile(
                    leading: CircularProgressIndicator(),
                    title: Text('加载账户信息…'));
              return ListTile(
                  leading: GestureDetector(
                      onTap: _pickAvatar,
                      child: CircleAvatar(
                          backgroundImage:
                              _resolveAssetUri(widget.serverUrl, user.avatar) ==
                                      null
                                  ? null
                                  : NetworkImage(_resolveAssetUri(
                                          widget.serverUrl, user.avatar)!
                                      .toString()),
                          child: user.avatar.isEmpty
                              ? Text(user.displayName.isEmpty
                                  ? '?'
                                  : user.displayName.substring(0, 1))
                              : null)),
                  title: Text(user.displayName),
                  subtitle: Text(user.email),
                  trailing: const Icon(Icons.edit_outlined),
                  onTap: () => _editNickname(user));
            }),
        const Divider(),
        ListTile(
            leading: const Icon(Icons.manage_accounts_outlined),
            title: const Text('账户'),
            subtitle: const Text('切换已保存的登录账户'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _chooseAccount),
        ListTile(
            leading: const Icon(Icons.qr_code_scanner),
            title: const Text('扫描二维码'),
            subtitle: const Text('扫描链接或查看二维码文本'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const QrScannerPage()))),
        ListTile(
            leading: Icon(Icons.dns),
            title: Text('服务器'),
            subtitle: Text('配置 MagicChat Server 地址'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _editServer),
        ListTile(
            leading: const Icon(Icons.palette_outlined),
            title: const Text('外观'),
            subtitle: const Text('主题设置'),
            trailing: DropdownButton<ThemeMode>(
                value: widget.themeMode,
                onChanged: (mode) {
                  if (mode != null) widget.onThemeChanged?.call(mode);
                },
                items: const [
                  DropdownMenuItem(
                      value: ThemeMode.system, child: Text('跟随系统')),
                  DropdownMenuItem(value: ThemeMode.light, child: Text('浅色')),
                  DropdownMenuItem(value: ThemeMode.dark, child: Text('深色')),
                ])),
        SwitchListTile(
            secondary: const Icon(Icons.notifications_outlined),
            title: const Text('通知'),
            subtitle: const Text('接收新消息和系统通知'),
            value: _notificationsEnabled,
            onChanged: _setNotifications),
        ListTile(
            leading: const Icon(Icons.storage_outlined),
            title: const Text('存储空间'),
            subtitle: const Text('查看和清理本地缓存'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _showStorage),
        ListTile(
            leading: const Icon(Icons.system_update_outlined),
            title: const Text('检查更新'),
            subtitle: const Text('检查 MagicChat 新版本'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _checkForUpdate),
        const ListTile(
            leading: Icon(Icons.info_outline), title: Text('关于 MagicChat')),
        if (widget.onLogout != null)
          ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('退出登录'),
              onTap: widget.onLogout)
      ]);
}
