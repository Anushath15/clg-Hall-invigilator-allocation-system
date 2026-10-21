import '../../core/database.dart';

/// The database schema: every migration of the Electron app, under the same names, so a database
/// created by it opens here unchanged and a new one is built identically. Migrations only add.
void runMigrations(AppDatabase db) {
  db.run('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TEXT)');
  final migrations = <String, void Function(AppDatabase)>{
    '001_initial_schema': _m001,
    '002_rotation_global_order': _m002,
    '003_notifications': _m003,
    '004_hall_floor': _m004,
    '005_notification_session': _m005,
    '006_deleted_batches': _m006,
    '007_rotation_outlives_session': _m007,
    '008_students_seating': _m008,
    '009_seating_config': _m009,
    '010_student_section': _m010,
    '011_seat_kinds': _m011,
    '012_subjects': _m012,
    '013_student_subjects': _m013,
  };
  for (final e in migrations.entries) {
    if (db.queryOne('SELECT name FROM _migrations WHERE name = ?', [e.key]) != null) continue;
    e.value(db);
    db.run('INSERT INTO _migrations(name, run_at) VALUES(?,?)', [e.key, DateTime.now().toUtc().toIso8601String()]);
  }
}

List<String> _columns(AppDatabase db, String table) => db.query('PRAGMA table_info($table)').map((c) => asStr(c['name'])).toList();

void _m001(AppDatabase db) {
  db.run('''CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))''');
  db.run('''CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT, designation TEXT,
    password_hash TEXT, role TEXT DEFAULT 'staff', department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))''');
  db.run('''CREATE TABLE IF NOT EXISTS halls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hall_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, capacity INTEGER DEFAULT 0,
    block TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))''');
  db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  db.run('''CREATE TABLE IF NOT EXISTS exam_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, academic_year TEXT NOT NULL, status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))''');
  db.run('''CREATE TABLE IF NOT EXISTS exam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
    exam_date TEXT NOT NULL, session_type TEXT NOT NULL, rotation_step INTEGER NOT NULL, reporting_time TEXT,
    exam_start TEXT, exam_end TEXT, status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))''');
  db.run('''CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    is_manually_edited INTEGER DEFAULT 0, edit_reason TEXT, generated_hall_id INTEGER REFERENCES halls(id),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, user_id), UNIQUE(session_id, hall_id))''');
  db.run('''CREATE TABLE IF NOT EXISTS rotation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE, hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    rotation_step INTEGER NOT NULL, recorded_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, session_id))''');
  db.run('''CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, description TEXT, payload TEXT,
    created_at TEXT DEFAULT (datetime('now')))''');
}

void _m002(AppDatabase db) {
  if (!_columns(db, 'rotation_history').contains('global_order')) db.run('ALTER TABLE rotation_history ADD COLUMN global_order INTEGER');
  db.run('CREATE INDEX IF NOT EXISTS idx_rotation_history_user_order ON rotation_history(user_id, global_order DESC)');
  var order = 1;
  for (final r in db.query('SELECT id FROM rotation_history ORDER BY datetime(recorded_at) ASC, id ASC')) {
    db.run('UPDATE rotation_history SET global_order = ? WHERE id = ?', [order++, r['id']]);
  }
}

void _m003(AppDatabase db) {
  db.run('''CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))''');
}

void _m004(AppDatabase db) {
  if (!_columns(db, 'halls').contains('floor')) db.run('ALTER TABLE halls ADD COLUMN floor TEXT');
}

void _m005(AppDatabase db) {
  if (!_columns(db, 'notifications').contains('session_id')) db.run('ALTER TABLE notifications ADD COLUMN session_id INTEGER');
}

void _m006(AppDatabase db) {
  db.run('''CREATE TABLE IF NOT EXISTS deleted_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, batch_name TEXT NOT NULL, academic_year TEXT, status TEXT, batch_created_at TEXT,
    session_count INTEGER NOT NULL DEFAULT 0, confirmed_session_count INTEGER NOT NULL DEFAULT 0, allocation_count INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT NOT NULL, deleted_by_name TEXT NOT NULL, deleted_by_staff_id TEXT NOT NULL)''');
}

// Rotation records outlive their session (session_id becomes optional, ON DELETE SET NULL).
void _m007(AppDatabase db) {
  db.transaction(() {
    db.run('''CREATE TABLE rotation_history_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES exam_sessions(id) ON DELETE SET NULL, hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
      rotation_step INTEGER NOT NULL, recorded_at TEXT DEFAULT (datetime('now')), global_order INTEGER, UNIQUE(user_id, session_id))''');
    db.run('''INSERT INTO rotation_history_new(id, user_id, session_id, hall_id, rotation_step, recorded_at, global_order)
              SELECT id, user_id, session_id, hall_id, rotation_step, recorded_at, global_order FROM rotation_history''');
    db.run('DROP TABLE rotation_history');
    db.run('ALTER TABLE rotation_history_new RENAME TO rotation_history');
    db.run('CREATE INDEX IF NOT EXISTS idx_rotation_history_user_order ON rotation_history(user_id, global_order DESC)');
  });
}

void _m008(AppDatabase db) {
  final cols = _columns(db, 'halls');
  if (!cols.contains('bench_rows')) db.run('ALTER TABLE halls ADD COLUMN bench_rows INTEGER DEFAULT 0');
  if (!cols.contains('bench_cols')) db.run('ALTER TABLE halls ADD COLUMN bench_cols INTEGER DEFAULT 0');
  if (!cols.contains('disabled_benches')) db.run("ALTER TABLE halls ADD COLUMN disabled_benches TEXT DEFAULT '[]'");
  db.run('''CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT, roll_no TEXT NOT NULL UNIQUE COLLATE NOCASE, register_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, gender TEXT NOT NULL CHECK (gender IN ('M','F')), department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    batch TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))''');
  db.run('CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch)');
  db.run('''CREATE TABLE IF NOT EXISTS seat_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE, hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    bench_row INTEGER NOT NULL, bench_col INTEGER NOT NULL, bench_no INTEGER NOT NULL, seat TEXT NOT NULL CHECK (seat IN ('L','R')),
    created_at TEXT DEFAULT (datetime('now')), UNIQUE(session_id, student_id), UNIQUE(session_id, hall_id, bench_row, bench_col, seat))''');
  db.run('CREATE INDEX IF NOT EXISTS idx_seat_allocations_session ON seat_allocations(session_id)');
}

void _m009(AppDatabase db) {
  if (!_columns(db, 'halls').contains('default_max_categories')) db.run('ALTER TABLE halls ADD COLUMN default_max_categories INTEGER');
  db.run('''CREATE TABLE IF NOT EXISTS seating_configs (
    session_id INTEGER PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE, config TEXT NOT NULL,
    student_ids TEXT NOT NULL DEFAULT '[]', unallocated TEXT NOT NULL DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now')))''');
}

void _m010(AppDatabase db) {
  if (!_columns(db, 'students').contains('section')) db.run("ALTER TABLE students ADD COLUMN section TEXT NOT NULL DEFAULT ''");
}

void _m011(AppDatabase db) {
  if (!_columns(db, 'halls').contains('seat_kinds')) db.run("ALTER TABLE halls ADD COLUMN seat_kinds TEXT DEFAULT '{}'");
}

void _m012(AppDatabase db) {
  db.run('''CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))''');
  db.run('''CREATE TABLE IF NOT EXISTS staff_subjects (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, subject_id))''');
}

void _m013(AppDatabase db) {
  db.run('''CREATE TABLE IF NOT EXISTS student_subjects (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (student_id, subject_id))''');
  db.run('CREATE INDEX IF NOT EXISTS idx_student_subjects_subject ON student_subjects(subject_id)');
}

const defaultCollegeName = "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil";
const defaultShortName = 'SXCCE';

void seedDefaults(AppDatabase db, String? appVersion) {
  const defaults = [
    ['college.name', defaultCollegeName],
    ['college.short_name', defaultShortName],
    ['session.fn_reporting_time', '09:30'],
    ['session.fn_start_time', '10:00'],
    ['session.fn_end_time', '13:00'],
    ['session.an_reporting_time', '13:30'],
    ['session.an_start_time', '14:00'],
    ['session.an_end_time', '17:00'],
    ['app.version', '1.1.0'],
  ];
  for (final d in defaults) {
    if (db.queryOne('SELECT key FROM settings WHERE key = ?', [d[0]]) == null) db.run('INSERT INTO settings(key, value) VALUES(?,?)', d);
  }
  if (appVersion != null) db.run("UPDATE settings SET value = ? WHERE key = 'app.version'", [appVersion]);
}

/// The offline app has no login: it always runs as the local administrator (ADMIN001), used for audit records.
void ensureDefaultAdmin(AppDatabase db) {
  if (db.queryOne("SELECT id FROM users WHERE role = 'admin'") == null) {
    db.run('INSERT INTO users(staff_id, name, role, is_active) VALUES(?,?,?,?)', ['ADMIN001', 'System Administrator', 'admin', 1]);
  }
}
