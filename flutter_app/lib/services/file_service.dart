import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:csv/csv.dart';
import 'package:excel/excel.dart';
import 'package:file_picker/file_picker.dart';

/// Files: open / save dialogs, reading the first sheet of an Excel or CSV file as rows, and
/// writing Excel templates. All local; nothing is sent anywhere.
class FileService {
  /// Asks for a file to open; null when cancelled.
  Future<String?> pickFile(List<String> extensions, {String? title}) async {
    final r = await FilePicker.platform.pickFiles(dialogTitle: title, type: FileType.custom, allowedExtensions: extensions);
    return r?.files.single.path;
  }

  /// Asks where to save; null when cancelled.
  Future<String?> pickSavePath(String defaultName, List<String> extensions, {String? title}) async {
    final path = await FilePicker.platform.saveFile(dialogTitle: title ?? 'Save', fileName: defaultName, type: FileType.custom, allowedExtensions: extensions);
    if (path == null) return null;
    final ext = extensions.first;
    return path.toLowerCase().endsWith('.$ext') ? path : '$path.$ext';
  }

  /// Saves bytes after asking where; returns the path, or null when cancelled.
  Future<String?> saveBytes(String defaultName, List<String> extensions, Uint8List bytes, {String? title}) async {
    final path = await pickSavePath(defaultName, extensions, title: title);
    if (path == null) return null;
    await File(path).writeAsBytes(bytes, flush: true);
    return path;
  }

  /// Asks for an Excel/CSV file and reads its first sheet as rows of cell values (text).
  Future<({String name, List<List<Object?>> rows})?> pickSheet() async {
    final path = await pickFile(['xlsx', 'csv']);
    if (path == null) return null;
    return (name: path.split(RegExp(r'[\\/]')).last, rows: readSheet(path));
  }

  List<List<Object?>> readSheet(String path) {
    final bytes = File(path).readAsBytesSync();
    if (path.toLowerCase().endsWith('.csv')) {
      final text = utf8.decode(bytes, allowMalformed: true).replaceFirst('﻿', '');
      return const CsvToListConverter(shouldParseNumbers: false, eol: '\n').convert(text.replaceAll('\r\n', '\n')).map((r) => r.map((c) => c?.toString()).toList()).toList();
    }
    final book = Excel.decodeBytes(bytes);
    if (book.tables.isEmpty) return [];
    final sheet = book.tables[book.tables.keys.first]!;
    return sheet.rows.map((r) => r.map((c) => _cellText(c?.value)).toList()).toList();
  }

  static String? _cellText(CellValue? v) {
    if (v == null) return null;
    return switch (v) {
      TextCellValue t => t.value.text ?? '',
      IntCellValue i => '${i.value}',
      DoubleCellValue d => d.value == d.value.roundToDouble() ? '${d.value.toInt()}' : '${d.value}',
      BoolCellValue b => '${b.value}',
      DateCellValue d => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
      _ => v.toString(),
    };
  }

  /// An Excel workbook with one sheet of [rows] (first row the header), as bytes.
  Uint8List buildWorkbook(String sheetName, List<List<String>> rows, {List<double>? widths}) {
    final book = Excel.createExcel();
    final defaultSheet = book.getDefaultSheet();
    book.rename(defaultSheet!, sheetName);
    final sheet = book[sheetName];
    for (final r in rows) {
      sheet.appendRow(r.map((c) => TextCellValue(c)).toList());
    }
    if (widths != null) {
      for (var i = 0; i < widths.length; i++) {
        sheet.setColumnWidth(i, widths[i]);
      }
    }
    return Uint8List.fromList(book.encode()!);
  }

  Future<String?> saveTemplate(String fileName, String sheetName, List<List<String>> rows, {List<double>? widths}) =>
      saveBytes(fileName, ['xlsx'], buildWorkbook(sheetName, rows, widths: widths), title: 'Save template');
}
