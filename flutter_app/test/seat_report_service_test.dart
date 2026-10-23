import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/seating_report.dart';
import 'package:hias/services/app_services.dart';

/// With too few halls, nothing is broken or hidden: the preview, the warnings after saving and the saved list of
/// students without a seat all name the rule that stopped them.
void main() {
  late AppServices s;
  late int session;

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    session = seedDemo(s).sessionIds[1];
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    // Two halls (48 seats) for 72 students.
    s.allocation.generate(session, staff.take(2).toList(), [for (final c in ['H101', 'H102']) s.master.halls().firstWhere((h) => h.hallCode == c).id]);
  });

  test('preview, saving and the saved list all say which rule stopped the students', () {
    final ids = s.students.list(isActive: true).map((x) => x.id).toList();
    final auto = s.students.autoConfigureSeating(session, ids);
    expect(auto.success, isTrue, reason: '${auto.error}');

    final preview = s.students.preview(session, ids, auto.config!);
    final report = preview.report!;
    final capacity = report.findings.firstWhere((f) => f.rule == 'Hall capacity');
    expect(capacity.status, RuleStatus.blocking);
    expect(capacity.detail, contains('short by'));
    expect(preview.errors, isEmpty, reason: 'no rule is broken: the students are left out instead');
    expect(preview.plan!.unallocated, isNotEmpty);
    for (final u in preview.plan!.unallocated) {
      expect(u.reason, startsWith('Blocked by'), reason: '${u.rollNo} must be told which rule');
    }

    final saved = s.students.confirm(session, ids, auto.config!, acceptUnallocated: true);
    expect(saved.success, isTrue, reason: '${saved.error}');
    expect(saved.warnings.any((w) => w.startsWith('Hall capacity:')), isTrue, reason: 'the warning after saving names the rule');
    final listed = s.students.savedSeating(session)!.unallocated;
    expect(listed.length, saved.unallocated.length);
    expect(listed.every((u) => u.reason.startsWith('Blocked by')), isTrue, reason: 'the saved reasons are the specific ones');
  });
}
