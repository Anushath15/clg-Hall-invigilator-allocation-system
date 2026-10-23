import 'package:flutter_test/flutter_test.dart';
import 'package:hias/controllers/seating_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';

void main() {
  late AppServices s;
  late StudentSelectorController c;

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s, runFirstSession: false);
    // Three subjects that the same class studies, plus one for another class: the usual real case.
    final ids = s.students.list().where((x) => x.rollNo.startsWith('22CS')).map((x) => x.id).toList();
    final other = s.students.list().where((x) => x.rollNo.startsWith('22EC')).map((x) => x.id).toList();
    for (final code in ['T1', 'T2', 'T3']) {
      final r = s.subjects.save(code: code, name: 'Test $code');
      s.subjects.setStudents(r.value!, ids);
    }
    s.subjects.setStudents(s.subjects.save(code: 'T4', name: 'Test T4').value!, other);
    c = StudentSelectorController(s, s.cycles.session(demo.sessionIds.first)!, academicYear: '2025-26', seats: 100, initialIds: const []);
  });

  test('clicking one subject chooses that subject only, though its students study others too', () {
    final t1 = c.subjects.firstWhere((x) => x.code == 'T1');
    c.setSubject(t1, true);
    expect(c.subjects.where(c.isPicked).map((x) => x.code), ['T1']);
    expect(c.selected.length, 18);
  });

  test('unticking a subject keeps the students another chosen subject still needs', () {
    final t1 = c.subjects.firstWhere((x) => x.code == 'T1');
    final t2 = c.subjects.firstWhere((x) => x.code == 'T2');
    c.setSubject(t1, true);
    c.setSubject(t2, true);
    c.setSubject(t1, false);
    expect(c.subjects.where(c.isPicked).map((x) => x.code), ['T2']);
    expect(c.selected.length, 18);
    c.setSubject(t2, false);
    expect(c.selected, isEmpty);
  });
}
