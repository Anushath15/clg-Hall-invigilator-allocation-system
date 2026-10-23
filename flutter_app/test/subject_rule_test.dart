import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/models/domain/seating_report.dart';
import 'package:hias/services/app_services.dart';

import 'support/seat_oracle.dart';

/// THE SUBJECT RULE OF AN EXAM HALL
///   * more than one subject in the exam: two students writing the same subject never share a bench and never sit side
///     by side - not even when they are from different classes that happen to write the same subject;
///   * only one subject for everybody: there is nobody to keep apart, so the rule does not apply and they may sit
///     together (the class rule still does).
void main() {
  SeatStudent st(int id, String g, int dept, String? subject, {String batch = '2023-2027'}) =>
      SeatStudent(id: id, rollNo: 'S$id', gender: g, batch: batch, departmentId: dept, deptCode: 'D$dept', paper: subject == null ? null : 'sub:$subject');
  SeatHall hall(int id, int rows, int cols) => SeatHall(id, 'H$id', HallLayout(rows: rows, cols: cols));

  ({SeatingPlan plan, SeatingConfig config, List<String> problems}) run(List<SeatStudent> students, List<SeatHall> halls) {
    final cfg = normalizeConfig(autoConfigure(students, halls), halls);
    final plan = planSeatingWithLocks(students, halls, cfg, '2026-2027', const []);
    final who = {for (final s in students) s.id: Sitter(s.gender, '${s.departmentId}|${s.batch}', s.paper)};
    return (plan: plan, config: cfg, problems: violations(halls, {for (final c in cfg.halls) c.hallId: c.pattern}, who, plan.seats.map(placed).toList()));
  }

  /// Benches that hold two students, and of those, how many hold two writing the same subject.
  ({int pairs, int sameSubject}) benches(SeatingPlan plan, List<SeatStudent> students) {
    final paper = {for (final s in students) s.id: s.paper};
    final by = <String, List<int>>{};
    for (final x in plan.seats) {
      by.putIfAbsent('${x.hallId}-${x.row}-${x.col}', () => []).add(x.studentId);
    }
    final two = by.values.where((l) => l.length == 2).toList();
    return (pairs: two.length, sameSubject: two.where((l) => paper[l[0]] != null && paper[l[0]] == paper[l[1]]).length);
  }

  group('more than one subject', () {
    test('students of one subject never share a bench or sit side by side, also across different classes', () {
      var pairsSeen = 0, sessions = 0;
      for (var seed = 1; seed <= 80; seed++) {
        final rnd = Random(seed * 13);
        final subjects = 2 + rnd.nextInt(3); // 2 to 4 subjects, shared by many classes
        final students = <SeatStudent>[];
        var id = 1;
        for (var d = 1; d <= 3 + rnd.nextInt(4); d++) {
          for (var b = 0; b < 2 + rnd.nextInt(3); b++) {
            final subject = '${1 + rnd.nextInt(subjects)}';
            for (var i = 0, n = 3 + rnd.nextInt(10); i < n; i++) {
              students.add(st(id++, rnd.nextBool() ? 'M' : 'F', d, subject, batch: '${2022 + b}-${2026 + b}'));
            }
          }
        }
        if (subjectsInExam(students) < 2) continue;
        final halls = <SeatHall>[];
        var seats = 0;
        while (seats < (students.length * 1.6).ceil()) {
          halls.add(hall(halls.length + 1, 3 + rnd.nextInt(4), 2 + rnd.nextInt(3)));
          seats += seatCount(halls.last.layout);
        }
        final r = run(students, halls);
        expect(r.problems, isEmpty, reason: 'seed $seed: ${r.problems}');
        final b = benches(r.plan, students);
        expect(b.sameSubject, 0, reason: 'seed $seed: two students of one subject share a bench');
        pairsSeen += b.pairs;
        sessions++;
      }
      expect(sessions, greaterThan(60));
      expect(pairsSeen, greaterThan(300), reason: 'many benches really hold two students, so the check means something');
    });

    test('a subject with more students than there are benches cannot all be seated: the rule is kept and named', () {
      // 30 boys writing X (three classes) and 10 writing Y, in a hall of 20 benches: X students each need a bench of
      // their own or one shared with a Y student, so 10 of them cannot be seated.
      final students = [
        for (var i = 1; i <= 10; i++) st(i, 'M', 1, 'X'),
        for (var i = 11; i <= 20; i++) st(i, 'M', 2, 'X'),
        for (var i = 21; i <= 30; i++) st(i, 'M', 3, 'X'),
        for (var i = 31; i <= 40; i++) st(i, 'M', 4, 'Y'),
      ];
      final r = run(students, [hall(1, 4, 5)]);
      expect(r.problems, isEmpty);
      expect(r.plan.unallocated.length, 10, reason: 'the 10 beyond the 20 benches');
      expect(benches(r.plan, students).sameSubject, 0, reason: 'the rule is never broken to seat them');
      final report = reportPlan(students: students, halls: [hall(1, 4, 5)], config: r.config, academicYear: '2026-2027', plan: r.plan);
      final f = report.findings.firstWhere((x) => x.rule == 'Same subject never adjacent');
      expect(f.status, RuleStatus.blocking);
      expect(f.detail, contains('only 20 benches'));
      for (final u in report.unallocated) {
        expect(u.reason, startsWith('Blocked by the same-subject rule'));
      }
    });
  });

  group('a class that writes more than one subject', () {
    test('classmates stay apart on a bench even when their subjects differ, and the same subject stays apart too', () {
      // Two classes, each writing two subjects (X and Y): 24 boys, 12 benches. A bench may hold X of one class with Y
      // of the other, never two of one class, never two of one subject.
      final students = [
        for (var i = 1; i <= 6; i++) st(i, 'M', 1, 'X'),
        for (var i = 7; i <= 12; i++) st(i, 'M', 1, 'Y'),
        for (var i = 13; i <= 18; i++) st(i, 'M', 2, 'X'),
        for (var i = 19; i <= 24; i++) st(i, 'M', 2, 'Y'),
      ];
      final r = run(students, [hall(1, 3, 4)]);
      expect(r.problems, isEmpty, reason: '${r.problems}');
      expect(r.plan.unallocated, isEmpty, reason: 'there is a legal arrangement for everyone');
      expect(benches(r.plan, students).sameSubject, 0);
      final byBench = <String, List<int>>{};
      for (final x in r.plan.seats) {
        byBench.putIfAbsent('${x.row}-${x.col}', () => []).add(x.studentId);
      }
      final classOf = {for (final s in students) s.id: s.departmentId};
      for (final l in byBench.values) {
        if (l.length == 2) expect(classOf[l[0]], isNot(classOf[l[1]]), reason: 'two classmates share a bench');
      }
    });
  });

  group('only one subject', () {
    test('the rule is lifted: students of that subject share benches, and nobody is turned away', () {
      // 40 boys of four classes, all writing X, and exactly 20 benches: every bench must hold two of them.
      final students = [for (var c = 0; c < 4; c++) for (var i = 1; i <= 10; i++) st(c * 10 + i, 'M', c + 1, 'X')];
      expect(subjectRulesApply(students), isFalse);
      final r = run(students, [hall(1, 4, 5)]);
      expect(r.problems, isEmpty);
      expect(r.plan.unallocated, isEmpty, reason: 'everybody is seated');
      final b = benches(r.plan, students);
      expect(b.pairs, 20);
      expect(b.sameSubject, 20, reason: 'every bench holds two students of the one subject');
      // The class rule still holds: no bench has two of one class (the checker verifies it too).
      final classOf = {for (final s in students) s.id: s.departmentId};
      final by = <String, List<int>>{};
      for (final x in r.plan.seats) {
        by.putIfAbsent('${x.row}-${x.col}', () => []).add(x.studentId);
      }
      for (final l in by.values) {
        if (l.length == 2) expect(classOf[l[0]], isNot(classOf[l[1]]));
      }
    });

    test('no subject at all is the same: only the class rule is used', () {
      final students = [for (var c = 0; c < 4; c++) for (var i = 1; i <= 10; i++) st(c * 10 + i, 'M', c + 1, null)];
      final r = run(students, [hall(1, 4, 5)]);
      expect(r.problems, isEmpty);
      expect(r.plan.unallocated, isEmpty);
    });

    test('the report says why the rule does not apply', () {
      final students = [for (var c = 0; c < 4; c++) for (var i = 1; i <= 10; i++) st(c * 10 + i, 'M', c + 1, 'X')];
      final r = run(students, [hall(1, 4, 5)]);
      final f = reportPlan(students: students, halls: [hall(1, 4, 5)], config: r.config, academicYear: '2026-2027', plan: r.plan).findings.firstWhere((x) => x.rule == 'Same subject never adjacent');
      expect(f.status, RuleStatus.notApplicable);
      expect(f.detail, contains('only one subject'));
    });

    test('the same students with a second subject are kept apart again', () {
      // 20 write X and 20 write Y, two classes each: with two subjects the rule is back, and 20 benches seat all 40.
      final students = [
        for (var i = 1; i <= 10; i++) st(i, 'M', 1, 'X'),
        for (var i = 11; i <= 20; i++) st(i, 'M', 2, 'X'),
        for (var i = 21; i <= 30; i++) st(i, 'M', 3, 'Y'),
        for (var i = 31; i <= 40; i++) st(i, 'M', 4, 'Y'),
      ];
      expect(subjectRulesApply(students), isTrue);
      final r = run(students, [hall(1, 4, 5)]);
      expect(r.problems, isEmpty);
      expect(r.plan.unallocated, isEmpty);
      expect(benches(r.plan, students).sameSubject, 0);
    });
  });

  group('through the application', () {
    test('choosing one subject for the whole session seats everybody; choosing two keeps their students apart', () {
      final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
      final demo = seedDemo(s);
      final session = demo.sessionIds[1];
      final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
      s.allocation.generate(session, staff.take(4).toList(), [for (final c in ['H101', 'H102', 'H201', 'H202']) s.master.halls().firstWhere((h) => h.hallCode == c).id]);
      final subs = s.subjects.list().where((x) => x.studentIds.isNotEmpty).toList();
      final ids = s.students.list(isActive: true).map((x) => x.id).toList();

      // One subject chosen: only students mapped to it write it; with one subject in the exam the rule does not apply.
      final one = subs.take(1).map((x) => x.id).toList();
      var auto = s.students.autoConfigureSeating(session, ids, sessionSubjects: one);
      var p = s.students.preview(session, ids, auto.config!.copyWith(sessionSubjects: one));
      var f = p.report!.findings.firstWhere((x) => x.rule == 'Same subject never adjacent');
      expect(f.status, RuleStatus.notApplicable);
      expect(f.detail, contains('only one subject'));
      expect(p.plan!.unallocated, isEmpty);

      // Two subjects chosen: the rule applies, and is met.
      final two = subs.take(2).map((x) => x.id).toList();
      auto = s.students.autoConfigureSeating(session, ids, sessionSubjects: two);
      p = s.students.preview(session, ids, auto.config!.copyWith(sessionSubjects: two));
      f = p.report!.findings.firstWhere((x) => x.rule == 'Same subject never adjacent');
      expect(f.status, RuleStatus.met);
      expect(p.errors, isEmpty);
    });
  });
}
