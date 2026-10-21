/// Field rules for every form (format checks only; HIAS is fully offline). Each returns an error
/// message, or null when the value is fine. Used by the forms, the services and the Excel imports.

final _letter = RegExp(r'\p{L}', unicode: true);
bool _onlyDigitsOrSymbols(String s) => !_letter.hasMatch(s);
String _s(Object? v) => (v ?? '').toString().trim();

String? validateStaffId(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Staff ID is required.';
  if (v.length > 20) return 'Staff ID can be at most 20 characters.';
  if (!RegExp(r'^[A-Za-z0-9._/-]+$').hasMatch(v)) return 'Staff ID can contain only letters, digits and - _ . / (no spaces).';
  return null;
}

String? validateStaffName(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Full Name is required.';
  if (v.length < 2) return 'Full Name is too short.';
  if (v.length > 80) return 'Full Name can be at most 80 characters.';
  if (_onlyDigitsOrSymbols(v)) return 'Full Name must contain letters, not only numbers or symbols.';
  if (!RegExp(r"^[\p{L}\p{M}0-9 .'’,&()-]+$", unicode: true).hasMatch(v)) {
    return "Full Name contains a character that is not allowed. Use letters, digits, spaces and . ' - ( ) , &";
  }
  return null;
}

String? validateBatchDeletion({required String batchName, Object? typedBatchName, Object? personName, Object? staffId}) {
  final typed = _s(typedBatchName);
  if (typed.isEmpty) return 'Type the batch name to confirm.';
  if (typed.toLowerCase() != batchName.trim().toLowerCase()) return 'The batch name does not match. Type it exactly as shown: $batchName';
  if (_s(personName).isEmpty) return 'Enter your name.';
  final name = validateStaffName(personName);
  if (name != null) return name.replaceFirst('Full Name', 'Your name');
  if (_s(staffId).isEmpty) return 'Enter your Staff ID.';
  return validateStaffId(staffId);
}

String? validateDesignation(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return null;
  if (v.length > 60) return 'Designation can be at most 60 characters.';
  if (_onlyDigitsOrSymbols(v)) return 'Designation must contain letters, not only numbers or symbols (for example Assistant Professor).';
  return null;
}

String? validateEmail(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return null;
  if (v.length > 120) return 'E-mail can be at most 120 characters.';
  if (!RegExp(r'^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$').hasMatch(v)) return 'E-mail is not valid. Use the form name@example.com.';
  return null;
}

String? validateStaff({Object? staffId, Object? name, Object? designation, Object? email}) =>
    validateStaffId(staffId) ?? validateStaffName(name) ?? validateDesignation(designation) ?? validateEmail(email);

String? validateDepartmentCode(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Code is required.';
  if (v.length > 12) return 'Code can be at most 12 characters.';
  if (!RegExp(r'^[A-Za-z0-9-]+$').hasMatch(v) || _onlyDigitsOrSymbols(v)) return 'Code must be letters and digits (for example CSE), with at least one letter.';
  return null;
}

String? validateDepartmentName(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Name is required.';
  if (v.length > 80) return 'Name can be at most 80 characters.';
  if (_onlyDigitsOrSymbols(v)) return 'Name must contain letters, not only numbers or symbols.';
  return null;
}

String? validateHallPlace(String label, Object? value) => _s(value).length > 40 ? '$label can be at most 40 characters.' : null;

String? validateStudentNumber(String label, Object? value) {
  final v = _s(value);
  if (v.isEmpty) return '$label is required.';
  if (v.length > 20) return '$label can be at most 20 characters.';
  if (!RegExp(r'^[A-Za-z0-9._/-]+$').hasMatch(v)) return '$label can contain only letters, digits and - _ . / (no spaces).';
  return null;
}

/// "M" or "F" for Male, Female, Boy, Girl, M, F; null otherwise.
String? parseGender(Object? value) {
  final v = _s(value).toLowerCase();
  if (['m', 'male', 'boy', 'b'].contains(v)) return 'M';
  if (['f', 'female', 'girl', 'g'].contains(v)) return 'F';
  return null;
}

String? validateStudentBatch(Object? value) {
  final m = RegExp(r'^(\d{4})\s*-\s*(\d{4})$').firstMatch(_s(value));
  if (m == null) return 'Batch must look like 2023-2027 (start year - end year).';
  if (int.parse(m.group(2)!) <= int.parse(m.group(1)!)) return 'Batch end year must be after the start year (for example 2023-2027).';
  return null;
}

String normalizeStudentBatch(Object? value) => _s(value).replaceFirst(RegExp(r'\s*-\s*'), '-');

String? validateStudentSection(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Section is required.';
  if (v.length > 10) return 'Section can be at most 10 characters.';
  if (!RegExp(r'^[A-Za-z0-9 -]+$').hasMatch(v)) return 'Section can contain only letters, digits, spaces and - (for example A or B2).';
  return null;
}

String normalizeStudentSection(Object? value) => _s(value).replaceAll(RegExp(r'\s+'), ' ').toUpperCase();

String? validateStudent({Object? rollNo, Object? registerNo, Object? name, Object? gender, Object? section, Object? batch}) =>
    validateStudentNumber('Roll Number', rollNo) ??
    validateStudentNumber('Register Number', registerNo) ??
    validateStaffName(name)?.replaceFirst('Full Name', 'Name') ??
    (parseGender(gender) != null ? null : 'Gender must be Male or Female.') ??
    validateStudentSection(section) ??
    validateStudentBatch(batch);

String? validateBatchName(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Batch name is required.';
  if (v.length > 100) return 'Batch name can be at most 100 characters.';
  if (_onlyDigitsOrSymbols(v)) return 'Batch name must contain letters, not only numbers or symbols.';
  return null;
}

String? validateAcademicYear(Object? value) {
  final m = RegExp(r'^(\d{4})-(\d{2}|\d{4})$').firstMatch(_s(value));
  if (m == null) return 'Academic year must look like 2026-27 or 2026-2027.';
  final first = int.parse(m.group(1)!), next = first + 1;
  final second = m.group(2)!;
  final ok = second.length == 2 ? int.parse(second) == next % 100 : int.parse(second) == next;
  if (!ok) return 'Academic year must span two consecutive years (for example $first-${'${first + 1}'.substring(2)}).';
  return null;
}

String? validateCollegeName(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'College Full Name is required.';
  if (v.length > 120) return 'College Full Name can be at most 120 characters.';
  return null;
}

String? validateCollegeShortName(Object? value) {
  final v = _s(value);
  if (v.isEmpty) return 'Short Name is required.';
  if (v.length > 12) return 'Short Name can be at most 12 characters.';
  return null;
}

final _hhmm = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');

String? validateTimeOfDay(Object? value) => _hhmm.hasMatch(_s(value)) ? null : 'Times must be valid, for example 09:30.';

String? validateSessionTimes(Object? reporting, Object? start, Object? end) {
  final r = _s(reporting), s = _s(start), e = _s(end);
  if (r.isEmpty || s.isEmpty || e.isEmpty) return 'Reporting time, exam start and exam end are all required.';
  if (![r, s, e].every(_hhmm.hasMatch)) return 'Times must be valid, for example 09:30.';
  if (r.compareTo(s) > 0) return 'Reporting time must be at or before the exam start.';
  if (e.compareTo(s) <= 0) return 'Exam end must be after the exam start.';
  return null;
}

String? validateSubject({Object? code, Object? name}) {
  final c = _s(code), n = _s(name);
  if (c.isEmpty) return 'Subject Code is required.';
  if (c.length > 20) return 'Subject Code must be at most 20 characters.';
  if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9 ._/-]*$').hasMatch(c)) return 'Subject Code may contain only letters, digits, spaces and . _ / -';
  if (n.isEmpty) return 'Subject Name is required.';
  if (n.length > 120) return 'Subject Name must be at most 120 characters.';
  return null;
}
