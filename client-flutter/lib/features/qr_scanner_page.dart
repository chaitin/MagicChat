import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';

/// 二维码扫描页。相机不可用的平台仍可粘贴二维码内容并按同一规则处理。
class QrScannerPage extends StatefulWidget {
  const QrScannerPage({super.key});

  @override
  State<QrScannerPage> createState() => _QrScannerPageState();
}

class _QrScannerPageState extends State<QrScannerPage> {
  bool _handled = false;

  void _handle(String raw) {
    if (_handled || raw.trim().isEmpty) return;
    _handled = true;
    final value = raw.trim();
    final uri = Uri.tryParse(value);
    if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
      launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('二维码内容'),
                content: SelectableText(raw),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('关闭'))
                ],
              )).whenComplete(() => _handled = false);
    }
  }

  Future<void> _paste() async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('输入二维码内容'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(hintText: '粘贴链接或文本')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, controller.text),
                    child: const Text('打开'))
              ],
            ));
    controller.dispose();
    if (value != null) _handle(value);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('扫描二维码')),
        body: Column(children: [
          Expanded(child: MobileScanner(onDetect: (capture) {
            final value = capture.barcodes.isEmpty
                ? null
                : capture.barcodes.first.rawValue;
            if (value != null) _handle(value);
          })),
          SafeArea(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: FilledButton.icon(
                      onPressed: _paste,
                      icon: const Icon(Icons.content_paste),
                      label: const Text('无法使用相机？粘贴二维码内容'))))
        ]),
      );
}
