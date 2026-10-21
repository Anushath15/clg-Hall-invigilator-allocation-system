import 'package:flutter/material.dart';

import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../services/report_service.dart';

/// Staff × confirmed session grid of hall codes (auto-generated in green, admin-edited in amber).
class AllocationMatrix extends StatelessWidget {
  const AllocationMatrix({super.key, required this.data, this.dark = true});
  final TimetableData data;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final sessions = data.confirmedSessions;
    if (sessions.isEmpty) {
      return const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No confirmed sessions yet. Confirm allocations to see the matrix.', style: TextStyle(color: AppColors.textSec))));
    }
    final lookup = {for (final a in data.allocations) '${a.userId}_${a.sessionId}': (code: data.hallCodes[a.hallId] ?? '?', edited: a.edited)};
    final head = dark ? AppColors.sidebar : AppColors.gray100;
    final headFg = dark ? Colors.white : AppColors.textMain;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Table(
          defaultColumnWidth: const FixedColumnWidth(80),
          columnWidths: const {0: FixedColumnWidth(200)},
          border: TableBorder.all(color: AppColors.border, width: 0.5),
          children: [
            TableRow(decoration: BoxDecoration(color: head), children: [
              Padding(padding: const EdgeInsets.all(8), child: Text('Staff / Session →', style: TextStyle(color: headFg, fontWeight: FontWeight.w700, fontSize: 13))),
              for (final s in sessions)
                Padding(
                  padding: const EdgeInsets.all(6),
                  child: Column(children: [
                    Text(formatDate(s.examDate).split(' ').take(2).join(' '), style: TextStyle(color: headFg, fontWeight: FontWeight.w700, fontSize: 12.5)),
                    Text('${s.examDate.substring(0, 4)} · ${s.sessionType}', style: TextStyle(color: dark ? AppColors.gray300 : AppColors.gray600, fontSize: 11.5)),
                  ]),
                ),
            ]),
            for (var i = 0; i < data.users.length; i++)
              TableRow(decoration: BoxDecoration(color: i.isEven ? Colors.white : AppColors.gray50), children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(data.users[i].name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    Text('${data.users[i].staffId} · ${data.users[i].deptCode ?? data.users[i].deptName ?? '—'}', style: const TextStyle(fontSize: 11.5, color: AppColors.textSec)),
                  ]),
                ),
                for (final s in sessions)
                  Builder(builder: (_) {
                    final cell = lookup['${data.users[i].id}_${s.id}'];
                    return Padding(
                      padding: const EdgeInsets.all(5),
                      child: Center(
                        child: cell == null
                            ? const Text('—', style: TextStyle(color: AppColors.gray300))
                            : Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: cell.edited ? AppColors.amber100 : AppColors.veryLight,
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(color: cell.edited ? const Color(0xFFFCD34D) : AppColors.light),
                                ),
                                child: Text(cell.code, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5, color: cell.edited ? AppColors.amber700 : AppColors.primary)),
                              ),
                      ),
                    );
                  }),
              ]),
          ],
        ),
      ),
      const SizedBox(height: 10),
      Wrap(spacing: 16, children: [
        _legend(AppColors.veryLight, AppColors.light, 'Auto-generated'),
        _legend(AppColors.amber100, const Color(0xFFFCD34D), 'Admin-edited'),
        const Text('—  Not yet allocated', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
      ]),
    ]);
  }

  Widget _legend(Color bg, Color border, String label) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 16, height: 12, decoration: BoxDecoration(color: bg, border: Border.all(color: border), borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
      ]);
}
