/// Student categories: a department with a batch ("CSE, 2022-2026"). The year of study comes from
/// the batch and the exam cycle's academic year. The last year of any batch is "Final Year".

const _ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

String categoryKey(int? departmentId, String batch) => '${departmentId ?? 0}|$batch';

int? academicStartYear(Object? academicYear) {
  final m = RegExp(r'(\d{4})').firstMatch('${academicYear ?? ''}');
  return m == null ? null : int.parse(m.group(1)!);
}

({int start, int end})? batchYears(String batch) {
  final m = RegExp(r'^(\d{4})\s*-\s*(\d{4})$').firstMatch(batch.trim());
  if (m == null) return null;
  final s = int.parse(m.group(1)!), e = int.parse(m.group(2)!);
  if (e <= s) return null;
  return (start: s, end: e);
}

class YearOfStudy {
  final bool ok;
  final int year, span;
  final String label, reason;
  const YearOfStudy.ok(this.year, this.span, this.label)
      : ok = true,
        reason = '';
  const YearOfStudy.fail(this.reason)
      : ok = false,
        year = 0,
        span = 0,
        label = '';
}

YearOfStudy yearOfStudy(String batch, Object? academicYear) {
  final b = batchYears(batch);
  if (b == null) return YearOfStudy.fail('Batch "$batch" is not in the form 2022-2026.');
  final start = academicStartYear(academicYear);
  if (start == null) return YearOfStudy.fail('The exam cycle\'s academic year "${academicYear ?? ''}" is not in the form 2025-2026.');
  final span = b.end - b.start, year = start - b.start + 1;
  if (year < 1) return YearOfStudy.fail('Batch $batch has not started in academic year $academicYear.');
  if (year > span) return YearOfStudy.fail('Batch $batch has already finished by academic year $academicYear.');
  return YearOfStudy.ok(year, span, yearLabel(year, span));
}

String yearLabel(int year, int span) {
  if (year == span) return 'Final Year';
  return year - 1 < _ordinals.length ? '${_ordinals[year - 1]} Year' : 'Year $year';
}

/// "CSE – Final Year"
String categoryLabel(String? deptCode, String yearText) => '${(deptCode == null || deptCode.isEmpty) ? '—' : deptCode} – $yearText';
