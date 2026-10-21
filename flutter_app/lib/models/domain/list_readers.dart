/// Readers for uploaded lists (rows of an Excel/CSV sheet): which invigilators (and halls) a duty
/// list names, and which students a seating list names. Pure logic.

String _norm(Object? v) => (v ?? '').toString().trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
Object? _cell(List<Object?> row, int i) => i >= 0 && i < row.length ? row[i] : null;

class DutyListResult {
  final List<int> userIds, hallIds;
  final bool hasHallColumn;
  final String matchedBy; // "staff id" | "name"
  final List<String> notFound, ambiguous, hallsNotFound, duplicates;
  const DutyListResult({required this.userIds, required this.hallIds, required this.hasHallColumn, required this.matchedBy, required this.notFound, required this.ambiguous, required this.hallsNotFound, required this.duplicates});
}

const _staffIdHeaders = ['staff id', 'staff_id', 'staffid', 'staff no', 'staff number', 'emp id', 'employee id', 'id', 'reg no'];
const _nameHeaders = ['name', 'staff name', 'full name', 'invigilator', 'invigilator name'];
const _hallHeaders = ['hall', 'hall code', 'hall_code', 'hall no', 'room'];

DutyListResult readDutyList(List<List<Object?>> rows, List<({int id, String staffId, String name})> staff, List<({int id, String hallCode})> halls) {
  final nonEmpty = rows.where((r) => r.any((c) => _norm(c).isNotEmpty)).toList();
  var headerIndex = -1, idCol = -1, nameCol = -1, hallCol = -1;
  for (var i = 0; i < nonEmpty.length && i < 5; i++) {
    final cells = nonEmpty[i].map(_norm).toList();
    int find(List<String> names) => cells.indexWhere(names.contains);
    final a = find(_staffIdHeaders), b = find(_nameHeaders), c = find(_hallHeaders);
    if (a != -1 || b != -1) {
      headerIndex = i;
      idCol = a;
      nameCol = b;
      hallCol = c;
      break;
    }
  }
  if (headerIndex == -1) idCol = 0;
  final body = nonEmpty.sublist(headerIndex + 1);
  final matchedBy = idCol != -1 ? 'staff id' : 'name';
  final byId = {for (final s in staff) _norm(s.staffId): s};
  final byName = <String, List<({int id, String staffId, String name})>>{};
  for (final s in staff) {
    byName.putIfAbsent(_norm(s.name), () => []).add(s);
  }
  final hallByCode = {for (final h in halls) _norm(h.hallCode): h};
  final userIds = <int>[], hallIds = <int>[];
  final notFound = <String>[], ambiguous = <String>[], hallsNotFound = <String>[], duplicates = <String>[];
  for (final row in body) {
    final col = matchedBy == 'staff id' ? idCol : nameCol;
    final key = _norm(_cell(row, col));
    if (key.isNotEmpty) {
      final shown = '${_cell(row, col)}'.trim();
      ({int id, String staffId, String name})? match;
      var skip = false;
      if (matchedBy == 'staff id') {
        match = byId[key];
      } else {
        final candidates = byName[key] ?? const [];
        if (candidates.length > 1) {
          ambiguous.add(shown);
          skip = true;
        } else {
          match = candidates.firstOrNull;
        }
      }
      if (skip) continue;
      if (match == null) {
        notFound.add(shown);
      } else if (userIds.contains(match.id)) {
        duplicates.add(shown);
      } else {
        userIds.add(match.id);
      }
    }
    if (hallCol != -1) {
      final code = _norm(_cell(row, hallCol));
      if (code.isEmpty) continue;
      final hall = hallByCode[code];
      if (hall == null) {
        hallsNotFound.add('${_cell(row, hallCol)}'.trim());
      } else if (!hallIds.contains(hall.id)) {
        hallIds.add(hall.id);
      }
    }
  }
  return DutyListResult(userIds: userIds, hallIds: hallIds, hasHallColumn: hallCol != -1, matchedBy: matchedBy, notFound: notFound, ambiguous: ambiguous, hallsNotFound: hallsNotFound, duplicates: duplicates);
}

const _studentHeaders = ['register no', 'register number', 'register_no', 'reg no', 'regno', 'roll no', 'roll number', 'roll_no', 'rollno', 'roll'];

/// Which students a list of register or roll numbers names (register numbers first, then roll numbers).
({List<int> studentIds, List<String> notFound, List<String> duplicates}) readStudentList(List<List<Object?>> rows, List<({int id, String rollNo, String registerNo})> students) {
  String n(Object? v) => (v ?? '').toString().trim().toLowerCase();
  final nonEmpty = rows.where((r) => r.any((c) => n(c).isNotEmpty)).toList();
  var headerIndex = -1, col = 0;
  for (var i = 0; i < nonEmpty.length && i < 5; i++) {
    final c = nonEmpty[i].map(n).toList().indexWhere(_studentHeaders.contains);
    if (c != -1) {
      headerIndex = i;
      col = c;
      break;
    }
  }
  final byReg = {for (final s in students) n(s.registerNo): s};
  final byRoll = {for (final s in students) n(s.rollNo): s};
  final ids = <int>[], notFound = <String>[], duplicates = <String>[];
  for (final row in nonEmpty.sublist(headerIndex + 1)) {
    final key = n(_cell(row, col));
    if (key.isEmpty) continue;
    final shown = '${_cell(row, col)}'.trim();
    final s = byReg[key] ?? byRoll[key];
    if (s == null) {
      notFound.add(shown);
    } else if (ids.contains(s.id)) {
      duplicates.add(shown);
    } else {
      ids.add(s.id);
    }
  }
  return (studentIds: ids, notFound: notFound, duplicates: duplicates);
}
