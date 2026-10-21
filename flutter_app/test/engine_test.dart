import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/models/domain/assignment.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/services/cycle_service.dart';

void main() {
  test('seeded draw matches the Electron app (cyrb53)', () {
    expect(pairDraw('1|5|2026-10-21 10:00:00|1,2,3|4,5,6', 2, 5), closeTo(0.3196223401257776, 1e-15));
    expect(pairDraw('', 7, 9), closeTo(0.2573839553134142, 1e-15));
  });

  test('assignment avoids R1 repeats and is a permutation', () {
    final history = {1: [10], 2: [11], 3: [12]};
    final r = assignHalls([1, 2, 3], [10, 11, 12], (u) => history[u]!, 'seed');
    expect(r.unavoidableRepeats, 0);
    for (final e in r.entries) {
      expect(history[e.userId]!.contains(e.hallId), isFalse);
    }
    expect(r.entries.map((e) => e.hallId).toSet().length, 3);
  });

  test('seating never puts two of one class on a bench and validates clean', () {
    final halls = [SeatHall(1, 'H1', const HallLayout(rows: 5, cols: 4)), SeatHall(2, 'H2', const HallLayout(rows: 5, cols: 4))];
    final students = <SeatStudent>[
      for (var i = 0; i < 30; i++) SeatStudent(id: i + 1, rollNo: 'A${i + 1}', gender: i.isEven ? 'M' : 'F', batch: '2022-2026', departmentId: 1, deptCode: 'CSE'),
      for (var i = 0; i < 30; i++) SeatStudent(id: 100 + i, rollNo: 'B${i + 1}', gender: i.isEven ? 'M' : 'F', batch: '2023-2027', departmentId: 2, deptCode: 'ECE'),
    ];
    final cfg = autoConfigure(students, halls);
    final plan = planSeating(students, halls, cfg, '2025-2026');
    expect(validateSeatingPlan(plan.seats, plan.unallocated, students, halls, cfg), isEmpty);
    expect(plan.seats.length + plan.unallocated.length, students.length);
  });

  test('database end to end: batch, generate, confirm', () {
    final s = AppServices(AppDatabase.open(':memory:'));
    s.master.saveDepartment(code: 'CSE', name: 'Computer Science');
    for (var i = 1; i <= 3; i++) {
      s.master.saveStaff(staffId: 'STF$i', name: 'Staff $i', departmentId: 1);
      s.master.saveHall(hallCode: 'H$i', layout: const HallLayout(rows: 2, cols: 2));
    }
    final tomorrow = DateTime.now().add(const Duration(days: 2));
    final d = '${tomorrow.year}-${tomorrow.month.toString().padLeft(2, '0')}-${tomorrow.day.toString().padLeft(2, '0')}';
    final cycle = s.cycles.createCycle('Test Batch', '2026-2027');
    s.cycles.createSessions(cycle.id, [SessionInput(examDate: d, sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00')]);
    final session = s.cycles.sessions(cycle.id).first;
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    final halls = s.master.halls().map((h) => h.id).toList();
    final g = s.allocation.generate(session.id, staff, halls);
    expect(g.validation.isValid, isTrue);
    expect(s.allocation.confirm(session.id).success, isTrue);
    expect(asInt(s.db.queryOne('SELECT COUNT(*) c FROM rotation_history')?['c']), 3);
  });
}
