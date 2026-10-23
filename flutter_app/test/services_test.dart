import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/entities.dart';
import 'package:hias/services/app_services.dart';

import 'support/world.dart';

/// SUBJECTS, REPORTS, PDFs, WORKBOOKS AND BACKUPS: the supporting services around the allocation.
void main() {
  late World w;
  setUp(() => w = World());

  bool isPdf(Uint8List b) => b.length > 500 && String.fromCharCodes(b.take(5)) == '%PDF-';

  group('subjects', () {
    test('save validates, trims, refuses a repeated code in any case, and keeps the staff chosen', () {
      final staff = w.staff(2);
      final d = w.s.master.departments().first.id;
      final r = w.s.subjects.save(code: ' CS3401 ', name: '  Compiler   Design ', departmentId: d, staffIds: staff);
      expect(r.success, isTrue, reason: '${r.error}');
      final s = w.s.subjects.list().single;
      expect((s.code, s.name, s.departmentCode), ('CS3401', 'Compiler Design', 'CSE'));
      expect(s.staff.map((x) => x.id).toSet(), staff.toSet());
      expect(w.s.subjects.save(code: 'cs3401', name: 'Other').error, contains('already used by Compiler Design'));
      expect(w.s.subjects.save(code: '', name: 'X').error, contains('Subject Code'));
      expect(w.s.subjects.save(code: 'CS1', name: '').error, contains('Subject Name'));
      // editing the same subject keeps its own code
      expect(w.s.subjects.save(id: r.value, code: 'CS3401', name: 'Compilers', staffIds: [staff.first]).success, isTrue);
      expect(w.s.subjects.list().single.staff, hasLength(1));
    });

    test('students are mapped to subjects, unknown ids are ignored, and deleting a subject removes the mapping', () {
      final d = w.dept('ECE');
      for (var i = 1; i <= 3; i++) {
        w.s.students.save(rollNo: 'R$i', registerNo: 'G$i', name: 'Student $i', gender: 'M', departmentId: d, section: 'A', batch: '2023-2027');
      }
      final ids = w.s.students.list().map((x) => x.id).toList();
      final sid = w.s.subjects.save(code: 'EC1', name: 'Signals').value!;
      final r = w.s.subjects.setStudents(sid, [...ids, 9999, 0]);
      expect(r.value, 3);
      expect(w.s.subjects.list().single.studentIds.toSet(), ids.toSet());
      expect(w.s.subjects.setStudents(9999, ids).success, isFalse);
      w.s.subjects.setStudents(sid, [ids.first]);
      expect(w.s.subjects.list().single.studentIds, [ids.first]);
      w.s.subjects.delete(sid);
      expect(w.s.subjects.list(), isEmpty);
      expect(w.s.db.query('SELECT * FROM student_subjects'), isEmpty);
    });

    test('importing subjects: needs the columns, updates by code, adds staff, reports every bad row', () {
      w.staff(2);
      w.dept('ECE');
      expect(w.s.subjects.importSubjects([]).error, contains('missing required column'));
      expect(w.s.subjects.importSubjects([['Subject Code', 'Subject Name']]).error, contains('no data rows'));
      final r = w.s.subjects.importSubjects([
        ['Subject Code', 'Subject Name', 'Department', 'Staff IDs'],
        ['A1', 'Alpha', 'CSE', 'S1; S2'],
        ['A2', 'Beta', 'XYZ', ''], // unknown department
        ['', 'No code', '', ''], // invalid
        ['A3', 'Gamma', 'ECE', 'S1, NOPE'], // saved, staff id unknown
        [null, null, null, null], // blank rows are skipped
      ]);
      expect(r.success, isTrue);
      expect(r.inserted, 2);
      expect(r.issues.map((i) => i.row), [3, 4, 5]);
      expect(r.issues.first.reason, contains('XYZ'));
      expect(r.issues.last.reason, contains('NOPE'));
      final again = w.s.subjects.importSubjects([
        ['code', 'name', 'staff'],
        ['a1', 'Alpha Updated', ''],
      ]);
      expect(again.inserted, 1);
      final a1 = w.s.subjects.list().firstWhere((s) => s.code.toUpperCase() == 'A1');
      expect(a1.name, 'Alpha Updated');
      expect(a1.staff, hasLength(2), reason: 'staff already on the subject stay');
    });

    test('importing which student studies which subject', () {
      final d = w.dept('ECE');
      w.s.students.save(rollNo: 'R1', registerNo: 'G1', name: 'One', gender: 'F', departmentId: d, section: 'A', batch: '2023-2027');
      w.s.subjects.save(code: 'A1', name: 'Alpha');
      w.s.subjects.save(code: 'A2', name: 'Beta');
      expect(w.s.subjects.importStudentSubjects([['x', 'y'], ['R1', 'A1']]).error, contains('first row'));
      final r = w.s.subjects.importStudentSubjects([
        ['Roll No', 'Register No', 'Subject Codes'],
        ['R1', '', 'A1, A2'],
        ['', 'G1', 'a1;ZZ'], // by register number, one code unknown
        ['NOBODY', '', 'A1'],
        ['R1', '', ''],
      ]);
      expect(r.success, isTrue);
      expect(r.inserted, 3);
      expect(r.issues.map((i) => i.row), [3, 4, 5]);
      expect(w.s.subjects.list().firstWhere((s) => s.code == 'A1').studentIds, hasLength(1), reason: 'the same pair twice is one mapping');
    });

    test('a session with no seating has no subject clash', () {
      final b = w.batch([3]);
      expect(w.s.subjects.conflicts(b.sessions.single.id), isEmpty);
      expect(w.s.subjects.conflictOf(b.sessions.single.id), isNull);
    });
  });

  group('reports and PDFs on the demo college', () {
    late AppServices s;
    late DemoSeedResult demo;
    setUp(() {
      s = w.s;
      demo = seedDemo(s);
    });

    test('staff-wise, date-wise, timetable and audit reports describe confirmed work', () {
      final all = s.reports.staffWise();
      expect(all, isNotEmpty);
      final who = s.master.staff(role: 'staff').first;
      final mine = s.reports.staffWise(userId: who.id);
      expect(mine.every((r) => r['staff_id'] == who.staffId), isTrue);
      expect(s.reports.staffWise(fromYear: '2999-3000'), isEmpty);
      expect(s.reports.staffWise(toYear: '1999-2000'), isEmpty);
      final first = demo.sessionIds.first;
      final day = s.reports.dateWise(first);
      expect(day, isNotEmpty);
      expect(day.map((r) => r['hall_code']).toSet().length, day.length, reason: 'one invigilator row per hall');
      final t = s.reports.timetable(demo.cycleId);
      expect(t.sessions, isNotEmpty);
      expect(t.users, isNotEmpty);
      expect(t.hallCodes, isNotEmpty);
      expect(t.confirmedSessions.every((x) => x.isConfirmed), isTrue);
      expect(s.reports.audit(demo.cycleId), isNotEmpty);
      expect(s.reports.timetable(9999).sessions, isEmpty);
    });

    test('every PDF is a real, non-empty document', () async {
      final settings = s.master.settings();
      final sessionId = demo.sessionIds.first;
      final session = s.cycles.session(sessionId)!;
      final cycle = s.cycles.cycle(demo.cycleId);
      final alloc = s.allocation.sessionAllocation(sessionId);
      expect(isPdf(await s.pdf.allocationSheet(cycle: cycle, session: session, allocation: alloc, settings: settings)), isTrue);

      final seats = s.students.sessionSeating(sessionId);
      expect(seats, isNotEmpty, reason: 'the demo seats the first session');
      final hallIds = seats.map((x) => x.hallId).toSet();
      final halls = [
        for (final h in s.master.halls().where((h) => hallIds.contains(h.id)))
          SeatingHallInfo(id: h.id, hallCode: h.hallCode, block: h.block, floor: h.floor, invigilators: alloc.where((a) => a.hallId == h.id).map((a) => a.userName).toList(), layout: h.layout)
      ];
      expect(isPdf(await s.pdf.seatingPlan(cycle: cycle, session: session, halls: halls, seats: seats, settings: settings)), isTrue);
      expect(isPdf(await s.pdf.attendanceSheets(cycle: cycle, session: session, halls: halls, seats: seats, settings: settings)), isTrue);
      expect(isPdf(await s.pdf.studentSeatList(cycle: cycle, session: session, seats: seats, settings: settings)), isTrue);
      final unallocated = s.students.savedSeating(sessionId)?.unallocated ?? [];
      expect(isPdf(await s.pdf.unallocatedList(cycle: cycle, session: session, unallocated: unallocated, settings: settings)), isTrue);
      expect(isPdf(await s.pdf.allocationHistory(s.reports.audit(demo.cycleId), settings)), isTrue);
      expect(isPdf(await s.pdf.report('staffwise', rows: s.reports.staffWise(), settings: settings)), isTrue);
      expect(isPdf(await s.pdf.report('datewise', rows: s.reports.dateWise(sessionId), settings: settings)), isTrue);
      expect(isPdf(await s.pdf.report('audit', rows: s.reports.audit(demo.cycleId), settings: settings)), isTrue);
      expect(isPdf(await s.pdf.report('timetable', timetable: s.reports.timetable(demo.cycleId), settings: settings)), isTrue);
    });

    test('a PDF of nothing is still a valid document', () async {
      final settings = s.master.settings();
      expect(isPdf(await s.pdf.report('staffwise', rows: const [], settings: settings)), isTrue);
      expect(isPdf(await s.pdf.report('datewise', rows: const [], settings: settings)), isTrue);
    });
  });

  group('workbooks', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('hias_files_'));
    tearDown(() => dir.deleteSync(recursive: true));

    test('what is written to an Excel file reads back the same', () {
      final rows = [
        ['Roll No', 'Name'],
        ['23CS001', 'Anu Priya'],
        ['23CS002', 'தமிழ்'],
      ];
      final bytes = w.s.files.buildWorkbook('Students', rows, widths: [14, 30]);
      final f = File('${dir.path}/students.xlsx')..writeAsBytesSync(bytes);
      final back = w.s.files.readSheet(f.path);
      expect(back.map((r) => r.map((c) => c ?? '').toList()), rows);
    });

    test('a CSV file (with a byte order mark and Windows line ends) reads like a sheet', () {
      final f = File('${dir.path}/a.csv')..writeAsStringSync('\u{FEFF}Roll No,Name\r\n001,"Anu, P"\r\n');
      final rows = w.s.files.readSheet(f.path);
      expect(rows, [
        ['Roll No', 'Name'],
        ['001', 'Anu, P']
      ], reason: 'numbers stay text so leading zeros survive');
    });

    test('a student workbook goes through the importer', () {
      w.dept('CSE');
      final bytes = w.s.files.buildWorkbook('Students', [
        ['Roll No', 'Register No', 'Name', 'Gender', 'Department', 'Section', 'Batch'],
        ['R1', 'G1', 'Anu', 'F', 'CSE', 'A', '2023-2027'],
        ['R2', 'G2', 'Bala', 'M', 'CSE', 'A', '2023-2027'],
        ['R3', 'G1', 'Same register', 'M', 'CSE', 'A', '2023-2027'],
      ]);
      final f = File('${dir.path}/s.xlsx')..writeAsBytesSync(bytes);
      final r = w.s.students.importStudents(w.s.files.readSheet(f.path));
      expect(r.inserted, 2);
      expect(r.issues.single.row, 4);
    });
  });

  group('backup and restore', () {
    late Directory dir;
    late AppServices s;
    setUp(() {
      dir = Directory.systemTemp.createTempSync('hias_backup_');
      s = AppServices(AppDatabase.open('${dir.path}/live.db', appVersion: 'test'));
    });
    tearDown(() {
      s.db.close();
      dir.deleteSync(recursive: true);
    });

    test('a backup is a HIAS database; restoring it brings the old data back and keeps a safety copy', () {
      s.master.saveDepartment(code: 'CSE', name: 'Computer Science');
      final backup = '${dir.path}/backup.db';
      expect(s.backup.backup(backup).success, isTrue);
      expect(s.backup.checkBackupFile(backup), isNull);
      s.master.saveDepartment(code: 'ECE', name: 'Electronics');
      expect(s.master.departments(), hasLength(2));
      final r = s.backup.restore(backup);
      expect(r.success, isTrue, reason: '${r.error}');
      expect(s.master.departments().map((d) => d.code), ['CSE']);
      expect(File(r.value!).existsSync(), isTrue, reason: 'the data before the restore is kept');
      expect(r.value, contains('before-restore'));
    });

    test('files that are not HIAS backups are refused and nothing changes', () {
      s.master.saveDepartment(code: 'CSE', name: 'Computer Science');
      final text = File('${dir.path}/notes.txt')..writeAsStringSync('not a database at all');
      expect(s.backup.checkBackupFile('${dir.path}/missing.db'), contains('not found'));
      expect(s.backup.checkBackupFile(text.path), contains('not a HIAS database'));
      expect(s.backup.restore(text.path).success, isFalse);
      expect(s.backup.restore('${dir.path}/missing.db').success, isFalse);
      expect(s.master.departments(), hasLength(1));
    });
  });
}
