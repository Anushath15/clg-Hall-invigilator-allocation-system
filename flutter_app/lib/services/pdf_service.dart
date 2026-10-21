import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../core/database.dart';
import '../core/format.dart';
import '../models/domain/hall_layout.dart';
import '../models/domain/schema.dart';
import '../models/domain/seating.dart';
import '../models/entities.dart';
import 'report_service.dart';

/// Every PDF HIAS produces, built in memory from data already loaded (pure: no database writes).
/// Ink is dark for basic office printers: black text, dark rules, dark header bands.
class PdfService {
  /// A Unicode font from the computer (so dashes and dots print), else the built-in Helvetica.
  static final pw.ThemeData? _theme = () {
    for (final dir in const [r'C:\Windows\Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts', '/System/Library/Fonts/Supplemental']) {
      for (final pair in const [('arial.ttf', 'arialbd.ttf'), ('DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'), ('Arial.ttf', 'Arial Bold.ttf')]) {
        final r = File('$dir/${pair.$1}'), b = File('$dir/${pair.$2}');
        if (r.existsSync() && b.existsSync()) {
          return pw.ThemeData.withFont(base: pw.Font.ttf(r.readAsBytesSync().buffer.asByteData()), bold: pw.Font.ttf(b.readAsBytesSync().buffer.asByteData()));
        }
      }
    }
    return null;
  }();

  static pw.Document _doc() => pw.Document(theme: _theme);

  static const _ink = PdfColors.black;
  static const _inkNote = PdfColor(40 / 255, 40 / 255, 40 / 255);
  static const _rule = PdfColor(60 / 255, 60 / 255, 60 / 255);
  static const _headGreen = PdfColor(18 / 255, 100 / 255, 50 / 255);
  static const _headDark = PdfColor(18 / 255, 59 / 255, 42 / 255);
  static const _headRed = PdfColor(160 / 255, 28 / 255, 28 / 255);

  String _college(Map<String, String> s) => s['college.name'] ?? defaultCollegeName;
  String _short(Map<String, String> s) => s['college.short_name'] ?? defaultShortName;
  String get _now => formatDateTime(DateTime.now());

  pw.Widget _title(String college, String title, [String? subtitle]) => pw.Column(children: [
        pw.Text(college, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: _ink), textAlign: pw.TextAlign.center),
        pw.SizedBox(height: 3),
        pw.Text(title, style: const pw.TextStyle(fontSize: 10.5, color: _ink), textAlign: pw.TextAlign.center),
        if (subtitle != null) ...[pw.SizedBox(height: 2), pw.Text(subtitle, style: const pw.TextStyle(fontSize: 9, color: _ink), textAlign: pw.TextAlign.center)],
        pw.SizedBox(height: 6),
      ]);

  pw.Widget _note(String text) => pw.Text(text, style: const pw.TextStyle(fontSize: 8, color: _inkNote));

  pw.Widget _table(List<String> head, List<List<String>> body,
      {PdfColor headColor = _headGreen, double fontSize = 8, Map<int, pw.TableColumnWidth>? widths, double minRowHeight = 0, Map<int, pw.Alignment>? align}) {
    return pw.TableHelper.fromTextArray(
      headers: head,
      data: body,
      border: pw.TableBorder.all(color: _rule, width: 0.5),
      headerStyle: pw.TextStyle(fontSize: fontSize, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
      headerDecoration: pw.BoxDecoration(color: headColor),
      cellStyle: pw.TextStyle(fontSize: fontSize, color: _ink),
      cellHeight: minRowHeight,
      cellAlignment: pw.Alignment.centerLeft,
      cellAlignments: align ?? const {},
      columnWidths: widths,
      cellPadding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 3),
    );
  }

  String _sessionLine(ExamSession s, {bool reporting = false}) => [
        formatDateWithDay(s.examDate),
        formatSession(s.sessionType),
        if (reporting && s.reportingTime != null) 'Report: ${formatTime12h(s.reportingTime)}',
        if (s.examStart != null && s.examEnd != null) 'Exam: ${formatTime12h(s.examStart)}–${formatTime12h(s.examEnd)}',
      ].join(' · ');

  String _cycleTitle(String title, ExamCycle? c) => '$title${c != null ? ' — ${c.name}' : ''}${c != null ? ' (${c.academicYear})' : ''}';

  // ── Invigilator allocation sheet ────────────────────────

  Future<Uint8List> allocationSheet({required ExamCycle? cycle, required ExamSession session, required List<AllocationRow> allocation, required Map<String, String> settings}) {
    final doc = _doc();
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => [
        _title(_college(settings), _cycleTitle('Invigilator Hall Allocation', cycle), _sessionLine(session, reporting: true)),
        _note('Generated: $_now · ${_short(settings)}'),
        pw.SizedBox(height: 6),
        _table(
          ['#', 'Staff ID', 'Name', 'Dept', 'Hall', 'Location', 'Adjusted By', 'Staff Signature'],
          [
            for (var i = 0; i < allocation.length; i++)
              [
                '${i + 1}',
                allocation[i].staffId,
                allocation[i].userName,
                allocation[i].deptCode ?? '—',
                allocation[i].hallCode,
                hallLocation(allocation[i].hallBlock, allocation[i].hallFloor).isEmpty ? '—' : hallLocation(allocation[i].hallBlock, allocation[i].hallFloor),
                '',
                ''
              ]
          ],
          fontSize: 8.5,
          minRowHeight: 40,
          widths: const {
            0: pw.FixedColumnWidth(18), 1: pw.FlexColumnWidth(17), 2: pw.FlexColumnWidth(30), 3: pw.FlexColumnWidth(12),
            4: pw.FlexColumnWidth(12), 5: pw.FlexColumnWidth(26), 6: pw.FlexColumnWidth(39), 7: pw.FlexColumnWidth(39)
          },
        ),
        pw.SizedBox(height: 8),
        _note('Total invigilators: ${allocation.length}'),
      ],
    ));
    return doc.save();
  }

  // ── Student seating ─────────────────────────────────────

  static const _classStyles = <({int fill, String border})>[
    (fill: 255, border: 'solid'), (fill: 200, border: 'none'), (fill: 255, border: 'dashed'), (fill: 225, border: 'solid'),
    (fill: 170, border: 'none'), (fill: 255, border: 'dotted'), (fill: 225, border: 'dashed'), (fill: 200, border: 'solid'),
    (fill: 255, border: 'thick'), (fill: 225, border: 'dotted'), (fill: 200, border: 'dashed'), (fill: 170, border: 'solid'),
  ];

  pw.BoxDecoration _seatBox(({int fill, String border}) st) {
    final g = st.fill / 255;
    final side = switch (st.border) {
      'none' => pw.BorderSide.none,
      'thick' => const pw.BorderSide(width: 1.6),
      'dashed' => const pw.BorderSide(width: 0.8, style: pw.BorderStyle.dashed),
      'dotted' => const pw.BorderSide(width: 0.8, style: pw.BorderStyle.dotted),
      _ => const pw.BorderSide(width: 0.8),
    };
    return pw.BoxDecoration(color: PdfColor(g, g, g), borderRadius: const pw.BorderRadius.all(pw.Radius.circular(2)), border: pw.Border.fromBorderSide(side));
  }

  static String groupLabel(String? g) => g == 'M' ? 'Boys' : g == 'F' ? 'Girls' : g == 'mixed' ? 'Boys & Girls' : '—';
  static String? seatsGroup(List<SeatRow> seats) => seats.map((s) => s.gender).toSet().length > 1 ? 'mixed' : seats.firstOrNull?.gender;

  pw.Widget _seatingHeader(String title, ExamCycle? cycle, ExamSession session, Map<String, String> settings) =>
      _title(_college(settings), _cycleTitle(title, cycle), _sessionLine(session));

  pw.Widget _hallLine(SeatingHallInfo hall, List<SeatRow> seats, {bool invigilators = true}) {
    final parts = [
      hallLocation(hall.block, hall.floor),
      groupLabel(seatsGroup(seats)),
      '${seats.length} students',
      if (invigilators && hall.invigilators.isNotEmpty) 'Invigilator: ${hall.invigilators.join(', ')}',
    ].where((s) => s.isNotEmpty);
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 4),
      child: pw.Row(children: [
        pw.Text('Hall ${hall.hallCode}', style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(width: 8),
        pw.Text(parts.join('  ·  '), style: const pw.TextStyle(fontSize: 9)),
      ]),
    );
  }

  List<({SeatingHallInfo hall, List<SeatRow> seats})> _hallsWithSeats(List<SeatingHallInfo> halls, List<SeatRow> seats) => [
        for (final h in halls)
          if (seats.any((s) => s.hallId == h.id)) (hall: h, seats: seats.where((s) => s.hallId == h.id).toList())
      ];

  /// A hall's classes in seating order, with roll number range and count.
  List<({String label, String range, int count})> _classSummary(List<SeatRow> seats) {
    final sorted = [...seats]..sort((a, b) => a.benchNo != b.benchNo ? a.benchNo - b.benchNo : a.seat.compareTo(b.seat));
    final groups = <String, List<SeatRow>>{};
    for (final s in sorted) {
      groups.putIfAbsent(s.colorKey, () => []).add(s);
    }
    return groups.entries.map((e) {
      final rolls = e.value.map((s) => s.rollNo).toList()..sort(naturalCompare);
      final range = rolls.length > 1 ? '${rolls.first} - ${rolls.last}' : rolls.first;
      return (label: e.key, range: '$range (${groupLabel(seatsGroup(e.value))})', count: e.value.length);
    }).toList();
  }

  /// One landscape page per hall: the benches as seen from the front and the class key table.
  Future<Uint8List> seatingPlan({required ExamCycle? cycle, required ExamSession session, required List<SeatingHallInfo> halls, required List<SeatRow> seats, required Map<String, String> settings}) {
    final doc = _doc();
    final classList = seats.map((s) => s.colorKey).toSet().toList()..sort();
    int classNo(String c) => math.max(0, classList.indexOf(c)) + 1;
    ({int fill, String border}) styleOf(String c) => _classStyles[(classNo(c) - 1) % _classStyles.length];
    final format = PdfPageFormat.a4.landscape;
    for (final hs in _hallsWithSeats(halls, seats)) {
      final h = hs.hall;
      final hSeats = hs.seats;
      final numbers = {for (final b in enabledBenches(h.layout)) benchKey(b.row, b.col): b};
      final at = <String, Map<String, SeatRow>>{};
      for (final s in hSeats) {
        at.putIfAbsent(benchKey(s.benchRow, s.benchCol), () => {})[s.seat] = s;
      }
      final mixed = seatsGroup(hSeats) == 'mixed';
      final hasChairs = numbers.values.any((b) => b.seats == 1);
      final classes = _classSummary(hSeats)..sort((a, b) => classNo(a.label) - classNo(b.label));
      final cols = math.max(1, h.layout.cols), rows = math.max(1, h.layout.rows);
      const margin = 24.0, labelW = 26.0, gapX = 6.0, gapY = 5.0;
      final usableW = format.width - 2 * margin;
      final tableH = 22.0 + 15.0 * (classes.length + 1);
      final usableH = format.height - 2 * margin - 70 - 16 - 22 - tableH;
      final cardW = math.min(147.0, (usableW - labelW - gapX * (cols - 1)) / cols);
      final cardH = math.max(18.0, math.min(math.min(48.0, cardW * 0.34), (usableH - gapY * (rows - 1)) / rows));
      final k = math.min(cardW / 147, cardH / 48);
      final pillH = 21 * k, pad = 5 * k;

      pw.Widget seatPill(SeatRow? s, double w) {
        if (s == null) {
          return pw.Container(
            width: w,
            height: pillH,
            alignment: pw.Alignment.center,
            decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfColors.grey600, width: 0.5, style: pw.BorderStyle.dotted), borderRadius: const pw.BorderRadius.all(pw.Radius.circular(2))),
            child: pw.Text('empty', style: pw.TextStyle(fontSize: math.max(4, 7 * k), fontStyle: pw.FontStyle.italic, color: PdfColors.grey700)),
          );
        }
        final tag = '${classNo(s.colorKey)}${mixed ? (s.gender == 'F' ? 'G' : 'B') : ''}';
        return pw.Container(
          width: w,
          height: pillH,
          padding: pw.EdgeInsets.symmetric(horizontal: 3 * k),
          decoration: _seatBox(styleOf(s.colorKey)),
          child: pw.Row(children: [
            pw.Expanded(child: pw.FittedBox(fit: pw.BoxFit.scaleDown, alignment: pw.Alignment.centerLeft, child: pw.Text(s.rollNo, style: pw.TextStyle(font: pw.Font.courierBold(), fontSize: math.max(5, 10.5 * k))))),
            pw.Text(tag, style: pw.TextStyle(fontSize: math.max(4, 7 * k), fontWeight: pw.FontWeight.bold)),
          ]),
        );
      }

      pw.Widget card(int r, int c) {
        final bench = numbers[benchKey(r, c)];
        if (bench == null) {
          return pw.Container(width: cardW, height: cardH, decoration: const pw.BoxDecoration(color: PdfColor(0.92, 0.92, 0.92), borderRadius: pw.BorderRadius.all(pw.Radius.circular(4))));
        }
        final b = at[benchKey(r, c)];
        final pillW = (cardW - 2 * pad - 4 * k) / 2;
        return pw.Container(
          width: cardW,
          height: cardH,
          padding: pw.EdgeInsets.all(pad),
          decoration: pw.BoxDecoration(color: PdfColors.white, border: pw.Border.all(color: const PdfColor(120 / 255, 120 / 255, 120 / 255), width: 0.6), borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4))),
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [
            pw.Text('${seatKindLabel[bench.kind]} ${bench.benchNo}', style: pw.TextStyle(fontSize: math.max(4, 7.5 * k), color: const PdfColor(40 / 255, 40 / 255, 40 / 255))),
            bench.seats == 2
                ? pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceBetween, children: [seatPill(b?['L'], pillW), seatPill(b?['R'], pillW)])
                : pw.Center(child: seatPill(b?['L'], pillW)),
          ]),
        );
      }

      final labelStyle = pw.TextStyle(fontSize: 9 * math.max(k, 0.75), fontWeight: pw.FontWeight.bold, color: const PdfColor(40 / 255, 40 / 255, 40 / 255));
      doc.addPage(pw.Page(
        pageFormat: format,
        margin: const pw.EdgeInsets.all(margin),
        build: (_) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
          _seatingHeader('Student Seating Plan', cycle, session, settings),
          _hallLine(h, hSeats, invigilators: false),
          pw.Container(
            height: 14,
            alignment: pw.Alignment.center,
            decoration: const pw.BoxDecoration(color: PdfColor(70 / 255, 70 / 255, 70 / 255), borderRadius: pw.BorderRadius.all(pw.Radius.circular(3))),
            child: pw.Text('FRONT  ·  BOARD', style: pw.TextStyle(color: PdfColors.white, fontSize: 8, fontWeight: pw.FontWeight.bold)),
          ),
          pw.SizedBox(height: 6),
          pw.Center(
            child: pw.Column(children: [
              pw.Row(mainAxisSize: pw.MainAxisSize.min, children: [
                pw.SizedBox(width: labelW),
                for (var c = 1; c <= cols; c++) pw.Container(width: cardW, margin: pw.EdgeInsets.only(left: c == 1 ? 0 : gapX), alignment: pw.Alignment.center, child: pw.Text('Column $c', style: labelStyle)),
              ]),
              pw.SizedBox(height: 3),
              for (var r = 1; r <= rows; r++)
                pw.Padding(
                  padding: pw.EdgeInsets.only(top: r == 1 ? 0 : gapY),
                  child: pw.Row(mainAxisSize: pw.MainAxisSize.min, children: [
                    pw.SizedBox(width: labelW, child: pw.Text('R$r', style: labelStyle)),
                    for (var c = 1; c <= cols; c++) pw.Padding(padding: pw.EdgeInsets.only(left: c == 1 ? 0 : gapX), child: card(r, c)),
                  ]),
                ),
            ]),
          ),
          pw.SizedBox(height: 8),
          pw.Text(
            '${mixed ? 'B = Boy    G = Girl     ' : ''}Each bench: left seat, right seat (as seen from the front)${hasChairs ? '; each chair: one seat' : ''}.   The number in a seat is its class (see KEY below).',
            style: const pw.TextStyle(fontSize: 8),
          ),
          pw.SizedBox(height: 5),
          pw.Center(
            child: pw.SizedBox(
              width: math.min(480, usableW),
              child: pw.Table(
                border: pw.TableBorder.all(width: 0.8),
                columnWidths: const {0: pw.FlexColumnWidth(10), 1: pw.FlexColumnWidth(35), 2: pw.FlexColumnWidth(40), 3: pw.FlexColumnWidth(15)},
                children: [
                  pw.TableRow(children: [for (final t in ['KEY', 'CLASS', 'ROLL NUMBERS SPACE', 'TOTAL']) _cellC(t, bold: true)]),
                  for (final c in classes)
                    pw.TableRow(children: [
                      pw.Container(
                        height: 15,
                        padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        child: pw.Container(decoration: _seatBox(styleOf(c.label)), alignment: pw.Alignment.center, child: pw.Text('${classNo(c.label)}', style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold))),
                      ),
                      _cellC(c.label),
                      _cellC(c.range),
                      _cellC(c.count.toString().padLeft(2, '0')),
                    ]),
                  pw.TableRow(children: [_cellC(''), _cellC(''), _cellC('TOTAL', bold: true, align: pw.Alignment.centerRight), _cellC(hSeats.length.toString().padLeft(2, '0'), bold: true)]),
                ],
              ),
            ),
          ),
        ]),
      ));
    }
    return doc.save();
  }

  pw.Widget _cellC(String t, {bool bold = false, pw.Alignment align = pw.Alignment.center}) => pw.Container(
        height: 15,
        alignment: align,
        padding: const pw.EdgeInsets.symmetric(horizontal: 3),
        child: pw.Text(t, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
      );

  pw.Widget _seatIcon(String side) => pw.Row(mainAxisAlignment: pw.MainAxisAlignment.center, children: [
        for (final s in const ['L', 'R'])
          pw.Container(
            width: 12,
            height: 9,
            margin: const pw.EdgeInsets.symmetric(horizontal: 1),
            decoration: pw.BoxDecoration(color: s == side ? const PdfColor(110 / 255, 110 / 255, 110 / 255) : PdfColors.white, border: pw.Border.all(width: 0.6), borderRadius: const pw.BorderRadius.all(pw.Radius.circular(1.5))),
          ),
      ]);

  /// One page per class in each hall, students in bench order with a signature column.
  Future<Uint8List> attendanceSheets({required ExamCycle? cycle, required ExamSession session, required List<SeatingHallInfo> halls, required List<SeatRow> seats, required Map<String, String> settings}) {
    final doc = _doc();
    for (final hs in _hallsWithSeats(halls, seats)) {
      final h = hs.hall;
      final classes = hs.seats.map((s) => s.colorKey).toSet().toList()..sort();
      for (final cls in classes) {
        final list = hs.seats.where((s) => s.colorKey == cls).toList()..sort((a, b) => a.benchNo != b.benchNo ? a.benchNo - b.benchNo : a.seat.compareTo(b.seat));
        doc.addPage(pw.MultiPage(
          pageFormat: PdfPageFormat.a4,
          margin: const pw.EdgeInsets.all(28),
          build: (_) => [
            _seatingHeader('Hall Attendance Sheet', cycle, session, settings),
            _hallLine(h, list),
            pw.Text('Class: $cls', style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 5),
            pw.Table(
              border: pw.TableBorder.all(color: _rule, width: 0.5),
              columnWidths: const {0: pw.FixedColumnWidth(22), 1: pw.FixedColumnWidth(38), 2: pw.FixedColumnWidth(44), 3: pw.FlexColumnWidth(22), 4: pw.FlexColumnWidth(30), 5: pw.FlexColumnWidth(54), 6: pw.FlexColumnWidth(38)},
              children: [
                pw.TableRow(decoration: const pw.BoxDecoration(color: _headGreen), children: [
                  for (final t in ['#', 'Bench', 'Seat', 'Roll No', 'Register No', 'Name', 'Signature'])
                    pw.Padding(padding: const pw.EdgeInsets.all(3), child: pw.Text(t, style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: PdfColors.white))),
                ]),
                for (var i = 0; i < list.length; i++)
                  pw.TableRow(verticalAlignment: pw.TableCellVerticalAlignment.middle, children: [
                    _cellT('${i + 1}', center: true),
                    _cellT('${list[i].benchNo}', center: true),
                    pw.Container(height: 22, alignment: pw.Alignment.center, child: _seatIcon(list[i].seat)),
                    _cellT(list[i].rollNo),
                    _cellT(list[i].registerNo),
                    _cellT(list[i].studentName),
                    _cellT(''),
                  ]),
              ],
            ),
            pw.SizedBox(height: 22),
            pw.Text('Present: ________     Absent: ________     Invigilator\'s signature: ______________________', style: const pw.TextStyle(fontSize: 8.5)),
          ],
        ));
      }
    }
    return doc.save();
  }

  pw.Widget _cellT(String t, {bool center = false}) => pw.Container(
      height: 22, alignment: center ? pw.Alignment.center : pw.Alignment.centerLeft, padding: const pw.EdgeInsets.symmetric(horizontal: 3), child: pw.Text(t, style: const pw.TextStyle(fontSize: 8)));

  /// Every student by batch, department and roll number, with hall, bench and seat.
  Future<Uint8List> studentSeatList({required ExamCycle? cycle, required ExamSession session, required List<SeatRow> seats, required Map<String, String> settings}) {
    final sorted = [...seats]..sort((a, b) {
        var c = a.batch.compareTo(b.batch);
        if (c != 0) return c;
        c = (a.deptCode ?? '').compareTo(b.deptCode ?? '');
        return c != 0 ? c : naturalCompare(a.rollNo, b.rollNo);
      });
    final doc = _doc();
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => [
        _seatingHeader('Student Seat List', cycle, session, settings),
        pw.Table(
          border: pw.TableBorder.all(color: _rule, width: 0.5),
          columnWidths: const {8: pw.FixedColumnWidth(40)},
          children: [
            pw.TableRow(decoration: const pw.BoxDecoration(color: _headGreen), children: [
              for (final t in ['Roll No', 'Register No', 'Name', 'Dept', 'Year', 'Batch', 'Hall', 'Bench', 'Seat'])
                pw.Padding(padding: const pw.EdgeInsets.all(3), child: pw.Text(t, style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: PdfColors.white))),
            ]),
            for (final s in sorted)
              pw.TableRow(verticalAlignment: pw.TableCellVerticalAlignment.middle, children: [
                _cellS(s.rollNo), _cellS(s.registerNo), _cellS(s.studentName), _cellS(s.deptCode ?? '—'), _cellS(s.year ?? ''), _cellS(s.batch),
                _cellS(s.hallCode, bold: true), _cellS('${s.benchNo}', center: true),
                pw.Container(height: 16, alignment: pw.Alignment.center, child: _seatIcon(s.seat)),
              ]),
          ],
        ),
        pw.SizedBox(height: 6),
        _note('Total students: ${seats.length}'),
      ],
    ));
    return doc.save();
  }

  pw.Widget _cellS(String t, {bool bold = false, bool center = false}) => pw.Container(
      height: 16,
      alignment: center ? pw.Alignment.center : pw.Alignment.centerLeft,
      padding: const pw.EdgeInsets.symmetric(horizontal: 3),
      child: pw.Text(t, style: pw.TextStyle(fontSize: 8, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)));

  Future<Uint8List> unallocatedList({required ExamCycle? cycle, required ExamSession session, required List<UnallocatedStudent> unallocated, required Map<String, String> settings}) {
    final sorted = [...unallocated]..sort((a, b) => naturalCompare(a.rollNo, b.rollNo));
    final doc = _doc();
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => [
        _seatingHeader('Unallocated Students', cycle, session, settings),
        _table(['#', 'Roll No', 'Name', 'Category', 'Gender', 'Reason'],
            [for (var i = 0; i < sorted.length; i++) ['${i + 1}', sorted[i].rollNo, sorted[i].name ?? '', sorted[i].category, sorted[i].gender == 'M' ? 'Male' : 'Female', sorted[i].reason]],
            widths: const {0: pw.FixedColumnWidth(22), 1: pw.FixedColumnWidth(68), 2: pw.FixedColumnWidth(110), 3: pw.FixedColumnWidth(140), 4: pw.FixedColumnWidth(46), 5: pw.FlexColumnWidth()}),
        pw.SizedBox(height: 6),
        _note("Total unallocated: ${unallocated.length}. These students have no seat in this session's seating plan."),
      ],
    ));
    return doc.save();
  }

  // ── History and reports ─────────────────────────────────

  Future<Uint8List> allocationHistory(List<DbRow> rows, Map<String, String> settings) {
    final doc = _doc();
    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => [
        pw.Text(_college(settings), style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
        pw.Text('Allocation History Report', style: const pw.TextStyle(fontSize: 10)),
        _note('Generated: $_now  ·  Records: ${rows.length}'),
        pw.SizedBox(height: 6),
        _table(['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Hall', 'Batch', 'Edited'], [
          for (final r in rows)
            [asStr(r['staff_id']), asStr(r['staffName']), asStr(r['deptCode'] ?? '—'), formatDate(asStr(r['exam_date'])), asStr(r['session_type']), asStr(r['hall_code']), asStr(r['cycleName']), asBool(r['is_manually_edited']) ? 'Yes' : 'No']
        ], headColor: _headDark),
      ],
    ));
    return doc.save();
  }

  static String _dept(DbRow r) => asStr(r['deptCode'] ?? r['deptName'] ?? '—');
  static String _where(DbRow r) {
    final l = hallLocation(asStrOrNull(r['hallBlock']), asStrOrNull(r['hallFloor']));
    return l.isEmpty ? '—' : l;
  }

  static String _time(Object? t) => t == null || '$t'.isEmpty ? '—' : formatTime12h('$t');
  static String _examTime(DbRow r) => r['exam_start'] != null && r['exam_end'] != null ? '${formatTime12h(asStr(r['exam_start']))}–${formatTime12h(asStr(r['exam_end']))}' : '—';

  static List<String> staffWiseCells(DbRow r) =>
      [asStr(r['staff_id']), asStr(r['staffName']), _dept(r), formatDate(asStr(r['exam_date'])), asStr(r['session_type']), asStr(r['hall_code']), _time(r['reporting_time']), _examTime(r), asStr(r['cycleName'])];
  static List<String> dateWiseCells(DbRow r) =>
      [asStr(r['hall_code']), _where(r), asStr(r['capacity']), asStr(r['staff_id']), asStr(r['staffName']), _dept(r), asStr(r['designation'] ?? '—'), _time(r['reporting_time']), _examTime(r)];
  static List<String> auditCells(DbRow r) => [
        asStr(r['staff_id']), asStr(r['staffName']), asStr(r['deptCode'] ?? '—'), formatDate(asStr(r['exam_date'])), asStr(r['session_type']),
        asStr(r['assignedHall']), asStr(r['generatedHall'] ?? '—'), asBool(r['is_manually_edited']) ? 'YES' : 'No', asStr(r['edit_reason'] ?? '—')
      ];

  static const staffWiseHead = ['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Hall', 'Report Time', 'Exam', 'Batch'];
  static const dateWiseHead = ['Hall', 'Location', 'Capacity', 'Staff ID', 'Name', 'Dept', 'Designation', 'Report Time', 'Exam'];
  static const auditHead = ['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Assigned Hall', 'Generated Hall', 'Edited', 'Reason'];

  Future<Uint8List> report(String kind, {List<DbRow>? rows, TimetableData? timetable, required Map<String, String> settings}) {
    const titles = {
      'staffwise': 'Staff-Wise Invigilation Duty Report',
      'datewise': 'Date-Wise Hall Allocation Sheet',
      'timetable': 'Complete Invigilation Timetable',
      'audit': 'Rotation Audit Report',
    };
    var title = titles[kind]!;
    if (kind == 'datewise' && rows != null && rows.isNotEmpty) {
      title = '$title — ${formatDateWithDay(asStr(rows.first['exam_date']))} (${formatSession(asStr(rows.first['session_type']))})';
    }
    final doc = _doc();
    pw.Widget body;
    if (kind == 'staffwise') {
      body = _table(staffWiseHead, rows!.map(staffWiseCells).toList());
    } else if (kind == 'datewise') {
      body = _table(dateWiseHead, rows!.map(dateWiseCells).toList());
    } else if (kind == 'audit') {
      body = _table(auditHead, rows!.map(auditCells).toList(), headColor: _headRed);
    } else {
      final t = timetable!;
      final sessions = t.confirmedSessions;
      final lookup = {for (final a in t.allocations) '${a.userId}_${a.sessionId}': t.hallCodes[a.hallId] ?? '?'};
      body = _table(
        ['Staff ID', 'Name', 'Dept', ...sessions.map((s) => '${formatDate(s.examDate)}\n${s.sessionType}')],
        [for (final u in t.users) [u.staffId, u.name, u.deptCode ?? u.deptName ?? '—', ...sessions.map((s) => lookup['${u.id}_${s.id}'] ?? '—')]],
        headColor: _headDark,
        fontSize: 7,
      );
    }
    doc.addPage(pw.MultiPage(
      pageFormat: kind == 'staffwise' ? PdfPageFormat.a4 : PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(28),
      build: (_) => [
        _title(_college(settings), title),
        _note('Generated: $_now · ${_short(settings)}'),
        pw.SizedBox(height: 6),
        body,
      ],
    ));
    return doc.save();
  }
}
