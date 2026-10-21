import 'dart:io';

import 'package:sqlite3/sqlite3.dart';

import '../core/database.dart';
import '../core/format.dart';
import '../models/entities.dart';

/// BACKUP AND RESTORE of the local database file (no network involved). A restore first checks the
/// chosen file is a HIAS database and keeps a timestamped safety copy of the current data.
class BackupService {
  BackupService(this.db, this.appVersion);
  final AppDatabase db;
  final String appVersion;

  static const _requiredTables = ['departments', 'users', 'halls', 'settings', 'exam_cycles', 'exam_sessions', 'allocations', 'rotation_history'];

  ActionResult<void> backup(String destPath) {
    try {
      db.backupTo(destPath);
      return const ActionResult.ok();
    } catch (e) {
      return ActionResult.fail('$e');
    }
  }

  /// Why [filePath] cannot be restored, or null if it is a readable HIAS database.
  String? checkBackupFile(String filePath) {
    if (!File(filePath).existsSync()) return 'Backup file not found.';
    try {
      final candidate = sqlite3.open(filePath, mode: OpenMode.readOnly);
      try {
        final tables = candidate.select("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => '${r['name']}').toSet();
        final missing = _requiredTables.where((t) => !tables.contains(t)).toList();
        if (missing.isNotEmpty) return 'This file is not a HIAS database backup (missing: ${missing.join(', ')}).';
      } finally {
        candidate.dispose();
      }
      return null;
    } catch (_) {
      return 'This file is not a HIAS database backup (it could not be read as a database).';
    }
  }

  /// Replaces the database with [srcPath] and opens it again at once (no restart needed).
  ActionResult<String?> restore(String srcPath) {
    try {
      final problem = checkBackupFile(srcPath);
      if (problem != null) return ActionResult.fail(problem);
      String? safetyCopy;
      final dest = File(db.path);
      db.close();
      try {
        if (dest.existsSync()) {
          final n = DateTime.now();
          safetyCopy = '${db.path}.before-restore-${n.year}${pad2(n.month)}${pad2(n.day)}-${pad2(n.hour)}${pad2(n.minute)}${pad2(n.second)}.bak';
          dest.copySync(safetyCopy);
        }
        File(srcPath).copySync(db.path);
      } finally {
        db.reopen(appVersion: appVersion);
      }
      return ActionResult.ok(safetyCopy);
    } catch (e) {
      return ActionResult.fail('$e');
    }
  }
}
