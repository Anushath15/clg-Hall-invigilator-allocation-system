import 'package:intl/intl.dart';

/// Formatting helpers shared by every screen and PDF (port of renderer/src/lib/utils.ts).

DateTime? parseIsoDate(String? date) {
  if (date == null || date.isEmpty) return null;
  // Dates are stored as YYYY-MM-DD (local), timestamps as "YYYY-MM-DD HH:MM:SS" (UTC from SQLite).
  return DateTime.tryParse(date.length == 19 && date[10] == ' ' ? '${date.replaceFirst(' ', 'T')}Z' : date)?.toLocal();
}

String _fmt(String? date, String pattern) {
  final d = parseIsoDate(date);
  return d == null ? (date ?? '') : DateFormat(pattern).format(d);
}

/// "05 Nov 2026"
String formatDate(String? date) => _fmt(date, 'dd MMM yyyy');

/// "Thu, 05 Nov 2026"
String formatDateWithDay(String? date) => _fmt(date, 'EEE, dd MMM yyyy');

/// "Thursday, 05 November 2026"
String formatFullDate(String? date) => _fmt(date, 'EEEE, dd MMMM yyyy');

/// "09:30" -> "09:30 AM"
String formatTime12h(String? time24) {
  if (time24 == null || time24.isEmpty) return '';
  final parts = time24.split(':');
  if (parts.length < 2) return time24;
  var hours = int.tryParse(parts[0]) ?? 0;
  final minutes = parts[1];
  final ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours == 0) hours = 12;
  return '${hours.toString().padLeft(2, '0')}:$minutes $ampm';
}

String formatSession(String sessionType) => sessionType == 'FN' ? 'Forenoon' : 'Afternoon';

String formatDateTime(DateTime d) => DateFormat('dd/MM/yyyy, hh:mm:ss a').format(d);

/// Where a hall is, e.g. "Main Block · 1st floor".
String hallLocation(String? block, String? floor) {
  final f = floor?.trim() ?? '';
  final floorText = f.isEmpty ? '' : (RegExp('floor', caseSensitive: false).hasMatch(f) ? f : '$f floor');
  return [block?.trim() ?? '', floorText].where((s) => s.isNotEmpty).join(' · ');
}

String capitalize(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// Today's date on this computer as YYYY-MM-DD (local time).
String todayLocal([DateTime? now]) {
  final d = now ?? DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// The time of day as HH:MM (24-hour, local).
String timeNowLocal([DateTime? now]) {
  final d = now ?? DateTime.now();
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

const pastDateMessage = 'That date has already passed. Choose today or a later date.';

bool isPastDate(String date, [String? today]) => date.compareTo(today ?? todayLocal()) < 0;

String isoDate(DateTime d) => todayLocal(d);

/// Search used across the lists: ignores case and surrounding spaces, matches anywhere.
bool matchesSearch(String query, List<Object?> fields) {
  final q = query.trim().toLowerCase();
  return q.isEmpty || fields.any((f) => (f?.toString() ?? '').toLowerCase().contains(q));
}

final _chunk = RegExp(r'(\d+|\D+)');

/// Natural, case-insensitive order (like Intl.Collator numeric): "STF2" before "STF10".
int naturalCompare(String a, String b) {
  final ca = _chunk.allMatches(a.toLowerCase()).map((m) => m.group(0)!).toList();
  final cb = _chunk.allMatches(b.toLowerCase()).map((m) => m.group(0)!).toList();
  for (var i = 0; i < ca.length && i < cb.length; i++) {
    final x = ca[i], y = cb[i];
    final nx = int.tryParse(x), ny = int.tryParse(y);
    int c;
    if (nx != null && ny != null) {
      c = nx.compareTo(ny);
    } else {
      c = x.compareTo(y);
    }
    if (c != 0) return c;
  }
  return ca.length.compareTo(cb.length);
}

/// Locale-like order for plain text: case-insensitive first, then exact.
int textCompare(String a, String b) {
  final c = a.toLowerCase().compareTo(b.toLowerCase());
  return c != 0 ? c : a.compareTo(b);
}

String pad2(int n) => n.toString().padLeft(2, '0');
