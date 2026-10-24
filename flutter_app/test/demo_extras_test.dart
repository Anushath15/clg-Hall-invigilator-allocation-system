import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_extras.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';

/// The extra demo data loads on top of the base demo, once, and leaves every option something to work on.
void main() {
  test('extras add classes, electives, a draft allocation and a second batch, and are applied only once', () {
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    seedDemoExtras(s);
    seedDemoExtras(s);
    expect(s.master.departments().map((d) => d.code), containsAll(['IT', 'CIVIL']));
    expect(s.cycles.cycles(), hasLength(2));
    expect(s.students.list().length, 72 + 53);
    expect(s.students.list(isActive: false), hasLength(1));
    expect(s.master.halls().where((h) => !h.isActive), hasLength(1));
    expect(s.master.staff().where((u) => !u.isActive), hasLength(1));
    expect(s.allocation.sessionAllocation(demo.sessionIds[1]), hasLength(4));
    expect(s.cycles.session(demo.sessionIds[1])!.status, 'draft');
    expect(s.subjects.list(), hasLength(10));
  });
}
