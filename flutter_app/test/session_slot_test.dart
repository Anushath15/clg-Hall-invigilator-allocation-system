import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/session_rules.dart';
import 'package:hias/models/entities.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/services/cycle_service.dart';

/// FN and AN, and different dates, are separate allocations. Only a session at the same time (same date, overlapping
/// times) can conflict: a student cannot write two exams at once and a hall cannot hold two.
void main() {
  const fn = SessionSlot(date: '2026-11-03', type: 'FN', from: '09:30', to: '13:00');
  const an = SessionSlot(date: '2026-11-03', type: 'AN', from: '13:30', to: '17:00');

  group('which sessions are at the same time', () {
    test('FN and AN of one date, and sessions of different dates, do not clash', () {
      expect(fn.clashesWith(an), isFalse);
      expect(fn.clashesWith(const SessionSlot(date: '2026-11-04', type: 'FN', from: '09:30', to: '13:00')), isFalse);
      expect(fn.clashesWith(const SessionSlot(date: '2026-11-03', type: 'AN', from: '13:00', to: '16:00')), isFalse, reason: 'one ends as the other begins');
    });

    test('the same date with overlapping times clashes, whatever the sessions are called', () {
      expect(fn.clashesWith(const SessionSlot(date: '2026-11-03', type: 'FN', from: '09:30', to: '13:00')), isTrue);
      expect(fn.clashesWith(const SessionSlot(date: '2026-11-03', type: 'AN', from: '12:00', to: '15:00')), isTrue);
    });

    test('a session without times is compared by its FN/AN slot', () {
      expect(const SessionSlot(date: '2026-11-03', type: 'FN').clashesWith(fn), isTrue);
      expect(const SessionSlot(date: '2026-11-03', type: 'AN').clashesWith(fn), isFalse);
    });
  });

  group('sessions of one batch', () {
    late AppServices s;
    late int cycle;

    setUp(() {
      s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
      cycle = s.cycles.createCycle('Series A', '2026-2027').id;
      final day = DateTime.now().add(const Duration(days: 20));
      final d = '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
      s.cycles.addSession(cycle, SessionInput(examDate: d, sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00'));
    });

    String dayOf() => s.cycles.sessions(cycle).first.examDate;

    test('FN and AN of one date with their own times are accepted', () {
      s.cycles.addSession(cycle, SessionInput(examDate: dayOf(), sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '17:00'));
      expect(s.cycles.sessions(cycle).length, 2);
    });

    test('an AN session whose times overlap the FN session is refused, and says which', () {
      expect(
          () => s.cycles.addSession(cycle, SessionInput(examDate: dayOf(), sessionType: 'AN', reportingTime: '12:00', examStart: '12:30', examEnd: '15:00')),
          throwsA(isA<ArgumentError>().having((e) => e.message, 'message', allOf(contains('overlaps'), contains('Forenoon')))));
      expect(s.cycles.sessions(cycle).length, 1, reason: 'nothing was added');
    });

    test('editing a session into an overlap is refused too; another date is fine', () {
      final an = s.cycles.addSession(cycle, SessionInput(examDate: dayOf(), sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '17:00'));
      expect(() => s.cycles.updateSession(an.id, SessionInput(examDate: dayOf(), sessionType: 'AN', reportingTime: '11:00', examStart: '11:30', examEnd: '15:00')), throwsA(isA<ArgumentError>()));
      final later = DateTime.parse(dayOf()).add(const Duration(days: 2));
      final moved = s.cycles.updateSession(an.id, SessionInput(examDate: '${later.year}-${later.month.toString().padLeft(2, '0')}-${later.day.toString().padLeft(2, '0')}', sessionType: 'AN', reportingTime: '11:00', examStart: '11:30', examEnd: '15:00'));
      expect(moved!.examDate, isNot(dayOf()));
    });
  });

  group('seating in two batches', () {
    late AppServices s;
    late DemoSeedResult demo;
    late ExamSession first; // seated, in the demo batch
    late int cycle2;
    List<int> allIds() => s.students.list(isActive: true).map((x) => x.id).toList();
    int hall(String code) => s.master.halls().firstWhere((h) => h.hallCode == code).id;

    /// A second batch with a session at [date] [type] [times], its invigilators in [halls].
    int otherSession(String date, String type, String from, String start, String end, List<String> halls) {
      final r = s.cycles.addSession(cycle2, SessionInput(examDate: date, sessionType: type, reportingTime: from, examStart: start, examEnd: end));
      final staff = s.master.staff(role: 'staff').map((u) => u.id).toList().reversed.take(halls.length).toList();
      s.allocation.generate(r.id, staff, [for (final h in halls) hall(h)]);
      return r.id;
    }

    setUp(() {
      s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
      demo = seedDemo(s);
      first = s.cycles.session(demo.sessionIds.first)!;
      cycle2 = s.cycles.createCycle('Series B', '2026-2027').id;
    });

    test('the other batch at the same time: its students and halls are left out, with the reason', () {
      final sess = otherSession(first.examDate, first.sessionType, first.reportingTime!, first.examStart!, first.examEnd!, ['LAB1', 'AUD']);
      // Ten students who are already seated at that time, six who are not.
      final seated = s.students.sessionSeating(first.id).take(10).map((x) => x.studentId).toList();
      final dept = s.master.departments().first.id;
      for (var i = 0; i < 6; i++) {
        expect(s.students.save(rollNo: 'NEW$i', registerNo: '99900000$i', name: 'New Student $i', gender: i.isEven ? 'M' : 'F', departmentId: dept, section: 'A', batch: '2025-2029').success, isTrue);
      }
      final fresh = s.students.list().where((x) => x.rollNo.startsWith('NEW')).map((x) => x.id).toList();
      final ids = [...seated, ...fresh];

      final auto = s.students.autoConfigureSeating(sess, ids);
      expect(auto.success, isTrue, reason: '${auto.error}');
      final r = s.students.confirm(sess, ids, auto.config!, acceptUnallocated: true);
      expect(r.success, isTrue, reason: '${r.error}');

      final now = s.students.sessionSeating(sess).map((x) => x.studentId).toSet();
      expect(now, fresh.toSet(), reason: 'only the students who are free at that time are seated');
      final listed = s.students.savedSeating(sess)!.unallocated;
      expect(listed.map((u) => u.studentId).toSet(), seated.toSet());
      for (final u in listed) {
        expect(u.reason, startsWith('Blocked by the one-exam-at-a-time rule'));
        expect(u.reason, contains('Demo November'));
      }
      expect(r.warnings.any((w) => w.contains('10 students are seated in another exam at the same time')), isTrue);
      expect(s.students.savedSeating(sess)!.studentIds.toSet(), ids.toSet(), reason: 'the selection is kept, so it can be seated again later');
    });

    test('a hall used by the other batch at the same time is not used here', () {
      final sess = otherSession(first.examDate, first.sessionType, first.reportingTime!, first.examStart!, first.examEnd!, ['H101', 'LAB1']);
      final ids = s.students.list(isActive: true).map((x) => x.id).toList().reversed.take(8).toList();
      final auto = s.students.autoConfigureSeating(sess, ids);
      expect(auto.success, isTrue, reason: '${auto.error}');
      final p = s.students.preview(sess, ids, auto.config!);
      expect(p.warnings.any((w) => w.contains('Hall H101 is used by Demo November')), isTrue);
      expect(p.plan!.halls.map((h) => h.hallCode), ['LAB1'], reason: 'H101 is not offered');
    });

    test('FN and AN of the same date, and another date, are separate: the same students can be seated, and nothing changes in the other', () {
      final before = s.students.sessionSeating(first.id).map((x) => '${x.studentId}@${x.hallId}-${x.benchNo}${x.seat}').toList();
      final ids = allIds();
      // AN of the same date, in a second batch, with the same halls.
      final an = otherSession(first.examDate, 'AN', '13:30', '14:00', '17:00', ['H101', 'H102', 'H201', 'H202']);
      final autoAn = s.students.autoConfigureSeating(an, ids);
      final rAn = s.students.confirm(an, ids, autoAn.config!, acceptUnallocated: true);
      expect(rAn.success, isTrue, reason: '${rAn.error}');
      expect(s.students.savedSeating(an)!.unallocated.where((u) => u.reason.contains('one-exam-at-a-time')), isEmpty);
      expect(s.students.sessionSeating(an).length, ids.length);
      // A later date.
      final later = DateTime.parse(first.examDate).add(const Duration(days: 4));
      final other = '${later.year}-${later.month.toString().padLeft(2, '0')}-${later.day.toString().padLeft(2, '0')}';
      final nextDay = otherSession(other, first.sessionType, first.reportingTime!, first.examStart!, first.examEnd!, ['H101', 'H102', 'H201', 'H202']);
      final autoNext = s.students.autoConfigureSeating(nextDay, ids);
      expect(s.students.confirm(nextDay, ids, autoNext.config!, acceptUnallocated: true).success, isTrue);
      expect(s.students.sessionSeating(nextDay).length, ids.length);
      // The first session was not touched by either.
      expect(s.students.sessionSeating(first.id).map((x) => '${x.studentId}@${x.hallId}-${x.benchNo}${x.seat}').toList(), before);
    });

    test('a seated session cannot be moved to a time at which its students are seated elsewhere', () {
      final later = DateTime.parse(first.examDate).add(const Duration(days: 4));
      final other = '${later.year}-${later.month.toString().padLeft(2, '0')}-${later.day.toString().padLeft(2, '0')}';
      final sess = otherSession(other, first.sessionType, first.reportingTime!, first.examStart!, first.examEnd!, ['H101', 'H102', 'H201', 'H202']);
      final ids = allIds();
      expect(s.students.confirm(sess, ids, s.students.autoConfigureSeating(sess, ids).config!, acceptUnallocated: true).success, isTrue);
      // Moving it onto the first session's time would seat the same students and halls twice at once.
      expect(
          () => s.cycles.updateSession(sess, SessionInput(examDate: first.examDate, sessionType: first.sessionType, reportingTime: first.reportingTime, examStart: first.examStart, examEnd: first.examEnd)),
          throwsA(isA<ArgumentError>().having((e) => e.message, 'message', allOf(contains('cannot move'), contains('students are also seated'), contains('hall')))));
      expect(s.cycles.session(sess)!.examDate, other, reason: 'it stayed where it was');
      // Moving it to the AN slot of the first date is fine: a different time.
      final moved = s.cycles.updateSession(sess, SessionInput(examDate: first.examDate, sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '17:00'));
      expect(moved!.sessionType, 'AN');
    });
  });
}
