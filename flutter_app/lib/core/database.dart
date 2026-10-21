import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

import '../models/domain/schema.dart';

typedef DbRow = Map<String, Object?>;

/// The local SQLite database. It is the same file the Electron app used (%APPDATA%\eias\eias.db on
/// Windows), so existing data opens unchanged. Every write goes straight to disk.
class AppDatabase {
  AppDatabase._(this._db, this.path);

  Database _db;
  final String path;
  int _txDepth = 0;

  static Future<String> defaultPath() async {
    String dir;
    if (Platform.isWindows && Platform.environment['APPDATA'] != null) {
      // Keep the folder the Electron app used, so installed machines keep their data.
      dir = p.join(Platform.environment['APPDATA']!, 'eias');
    } else {
      dir = p.join((await getApplicationSupportDirectory()).path, 'eias');
    }
    await Directory(dir).create(recursive: true);
    return p.join(dir, 'eias.db');
  }

  /// Opens the database (creating it if needed), runs pending migrations and fills in default settings.
  static AppDatabase open(String path, {String? appVersion}) {
    final db = AppDatabase._(path == ':memory:' ? sqlite3.openInMemory() : sqlite3.open(path), path);
    db._configure();
    runMigrations(db);
    seedDefaults(db, appVersion);
    ensureDefaultAdmin(db);
    return db;
  }

  void _configure() {
    // One file only (no -wal side files), so a backup copy of eias.db is always complete.
    _db.execute('PRAGMA journal_mode=DELETE');
    _db.execute('PRAGMA foreign_keys=ON');
  }

  /// Closes the file and opens [path] again (after a restore replaced it).
  void reopen({String? appVersion}) {
    _db.dispose();
    _db = sqlite3.open(path);
    _configure();
    runMigrations(this);
    seedDefaults(this, appVersion);
    ensureDefaultAdmin(this);
  }

  void close() => _db.dispose();

  static Object? _arg(Object? v) => v is bool ? (v ? 1 : 0) : v;

  /// Runs a statement; returns the new row id and how many rows changed.
  ({int lastInsertRowid, int changes}) run(String sql, [List<Object?> params = const []]) {
    if (params.isEmpty) {
      _db.execute(sql);
    } else {
      final stmt = _db.prepare(sql);
      try {
        stmt.execute(params.map(_arg).toList());
      } finally {
        stmt.dispose();
      }
    }
    return (lastInsertRowid: _db.lastInsertRowId, changes: _db.updatedRows);
  }

  List<DbRow> query(String sql, [List<Object?> params = const []]) {
    final rs = _db.select(sql, params.map(_arg).toList());
    return [for (final r in rs) Map<String, Object?>.from(r)];
  }

  DbRow? queryOne(String sql, [List<Object?> params = const []]) {
    final rows = query(sql, params);
    return rows.isEmpty ? null : rows.first;
  }

  /// Runs [fn] in one transaction: everything is kept, or (on an error) nothing. Nested calls join the outer one.
  T transaction<T>(T Function() fn) {
    if (_txDepth > 0) return fn();
    _db.execute('BEGIN TRANSACTION');
    _txDepth++;
    try {
      final r = fn();
      _db.execute('COMMIT');
      return r;
    } catch (_) {
      try {
        _db.execute('ROLLBACK');
      } catch (_) {/* nothing to roll back */}
      rethrow;
    } finally {
      _txDepth--;
    }
  }

  /// Copies the whole database into [dest] (a consistent snapshot).
  void backupTo(String dest) {
    final f = File(dest);
    if (f.existsSync()) f.deleteSync();
    _db.execute("VACUUM INTO '${dest.replaceAll("'", "''")}'");
  }

  void writeAuditLog(int? userId, String action, String description, [Object? payload]) {
    try {
      run("INSERT INTO audit_log(user_id, action, description, payload, created_at) VALUES(?,?,?,?,datetime('now'))",
          [userId, action, description, payload == null ? null : jsonEncode(payload)]);
    } catch (_) {/* the audit log never stops the action it records */}
  }
}

int asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);
int? asIntOrNull(Object? v) => v == null ? null : asInt(v);
String asStr(Object? v) => v?.toString() ?? '';
String? asStrOrNull(Object? v) => v?.toString();
bool asBool(Object? v) => v == true || (v is num && v != 0) || v == '1';
