import 'package:hias/core/database.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/entities.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/services/cycle_service.dart';

/// A small college to test against: an empty in-memory database, with helpers to fill it.
class World {
  World() : s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
  final AppServices s;

  /// The date [days] from today, as the app writes it (yyyy-mm-dd).
  static String day(int days) {
    final d = DateTime.now().add(Duration(days: days));
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  /// A session on [date]: forenoon 09:30-13:00 by default, afternoon 13:30-17:00.
  static SessionInput session(String date, [String type = 'FN']) => type == 'FN'
      ? SessionInput(examDate: date, sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00')
      : SessionInput(examDate: date, sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '17:00');

  int dept(String code, [String? name]) {
    final r = s.master.saveDepartment(code: code, name: name ?? '$code Department');
    if (!r.success) throw StateError('${r.error}');
    return r.value!.id;
  }

  /// [n] active staff S1..Sn (Anu A, Anu B, ...) in [deptId]; their ids.
  List<int> staff(int n, {int? deptId}) {
    final d = deptId ?? s.master.departments().firstOrNull?.id ?? dept('CSE');
    for (var i = 1; i <= n; i++) {
      final r = s.master.saveStaff(staffId: 'S$i', name: 'Anu ${String.fromCharCode(64 + i)}', departmentId: d);
      if (!r.success) throw StateError('${r.error}');
    }
    return s.master.staff(role: 'staff').where((u) => u.staffId.startsWith('S')).map((u) => u.id).toList();
  }

  /// [n] halls H1..Hn of [rows] x [cols] benches; their ids.
  List<int> halls(int n, {int rows = 4, int cols = 3}) {
    for (var i = 1; i <= n; i++) {
      final r = s.master.saveHall(hallCode: 'H$i', layout: HallLayout(rows: rows, cols: cols));
      if (!r.success) throw StateError('${r.error}');
    }
    return s.master.halls().map((h) => h.id).toList();
  }

  ExamCycle cycle([String name = 'Test Batch', String year = '2026-2027']) => s.cycles.createCycle(name, year);

  /// A new batch with one forenoon session per entry of [days]; the sessions in rotation order.
  ({ExamCycle cycle, List<ExamSession> sessions}) batch(List<int> days, {String name = 'Test Batch'}) {
    final c = cycle(name);
    s.cycles.createSessions(c.id, [for (final d in days) session(day(d))]);
    return (cycle: c, sessions: s.cycles.sessions(c.id));
  }

  /// A registered, active person who may delete a batch.
  void registrar() => s.master.saveStaff(staffId: 'REG1', name: 'Registrar One', departmentId: s.master.departments().firstOrNull?.id);
}
