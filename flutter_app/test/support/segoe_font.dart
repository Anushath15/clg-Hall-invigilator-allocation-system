import 'dart:io';

import 'package:flutter/services.dart';

/// Loads the app's own font (Segoe UI) so widget tests lay text out as wide as on a real Windows PC;
/// without it Flutter tests use a much wider placeholder font and report overflows that do not exist.
Future<void> loadSegoeUi() async {
  final loader = FontLoader('Segoe UI');
  for (final f in ['segoeui.ttf', 'segoeuib.ttf']) {
    final file = File('C:/Windows/Fonts/$f');
    if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
  }
  await loader.load();
}
