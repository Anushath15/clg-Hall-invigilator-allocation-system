import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/format.dart';
import 'common.dart';
import '../../core/theme.dart';

/// A month calendar for picking exam dates (weeks Sunday to Saturday). Sundays and days that have
/// passed cannot be picked. With [single], one date is picked and no order badges are shown.
class ExamCalendar extends StatefulWidget {
  const ExamCalendar({super.key, required this.selected, required this.onToggle, this.maxDates = 1, this.onAutoSelect, this.onClear, this.single = false});
  final List<String> selected;
  final ValueChanged<String> onToggle;
  final int maxDates;
  final VoidCallback? onAutoSelect, onClear;
  final bool single;

  @override
  State<ExamCalendar> createState() => _ExamCalendarState();
}

class _ExamCalendarState extends State<ExamCalendar> {
  late DateTime month;

  @override
  void initState() {
    super.initState();
    final first = widget.selected.isNotEmpty ? parseIsoDate(widget.selected.first) : null;
    final usable = first != null && !(widget.single && widget.selected.first.compareTo(todayLocal()) < 0);
    final d = usable ? first : DateTime.now();
    month = DateTime(d.year, d.month);
  }

  /// Every day of the month plus the days completing its first and last week.
  List<DateTime> get grid {
    final first = DateTime(month.year, month.month, 1);
    final start = first.subtract(Duration(days: first.weekday % 7));
    final last = DateTime(month.year, month.month + 1, 0);
    final end = last.add(Duration(days: 6 - last.weekday % 7));
    final out = <DateTime>[];
    for (var d = start; !d.isAfter(end); d = DateTime(d.year, d.month, d.day + 1)) {
      out.add(d);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final today = todayLocal();
    final sel = widget.selected;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
        child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 8, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            IconButton(onPressed: () => setState(() => month = DateTime(month.year, month.month - 1)), icon: const Icon(Icons.chevron_left), tooltip: 'Previous Month'),
            SizedBox(width: 160, child: Text(DateFormat('MMMM yyyy').format(month), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
            IconButton(onPressed: () => setState(() => month = DateTime(month.year, month.month + 1)), icon: const Icon(Icons.chevron_right), tooltip: 'Next Month'),
          ]),
          Row(mainAxisSize: MainAxisSize.min, children: [
            if (widget.onAutoSelect != null)
              OutlinedButton.icon(onPressed: widget.onAutoSelect, icon: const Icon(Icons.auto_awesome, size: 16), label: Text('Auto-Select ${widget.maxDates} Days'), style: OutlinedButton.styleFrom(foregroundColor: AppColors.primary)),
            if (sel.isNotEmpty && widget.onClear != null) TextButton.icon(onPressed: widget.onClear, icon: const Icon(Icons.cancel_outlined, size: 16), label: const Text('Clear')),
          ]),
        ]),
      ),
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
        child: Column(children: [
          Row(children: [
            for (final d in const ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
              Expanded(child: Center(child: Text(d, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: d == 'Sun' ? AppColors.red600 : AppColors.textMain)))),
          ]),
          const Divider(height: 16),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 4,
            crossAxisSpacing: 4,
            childAspectRatio: widget.single ? 1.6 : 1.3,
            children: [
              for (final day in grid)
                Builder(builder: (context) {
                  final ds = isoDate(day);
                  final inMonth = day.month == month.month;
                  final isSunday = day.weekday == DateTime.sunday;
                  final isPast = ds.compareTo(today) < 0;
                  final isToday = ds == today;
                  final idx = sel.indexOf(ds);
                  final selected = idx >= 0;
                  final disabled = isSunday || isPast;
                  Color bg = Colors.white, fg = AppColors.textMain, border = AppColors.gray100;
                  if (isSunday) {
                    bg = AppColors.red50;
                    fg = AppColors.error;
                    border = const Color(0xFFFEE2E2);
                  }
                  if (selected) {
                    bg = AppColors.primary;
                    fg = Colors.white;
                    border = AppColors.dark;
                  }
                  return Opacity(
                    opacity: !inMonth ? 0.35 : (isPast && !isSunday ? 0.4 : 1),
                    child: Tooltip(
                      message: isPast ? 'This date has already passed' : isSunday ? 'Sunday — Weekly Holiday (No Exams)' : DateFormat('EEEE, dd MMMM yyyy').format(day),
                      child: InkWell(
                        onTap: disabled ? null : () => widget.onToggle(ds),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.all(5),
                          decoration: BoxDecoration(
                            color: bg,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: isToday && !selected ? const Color(0xFF60A5FA) : border, width: isToday && !selected ? 2 : 1),
                          ),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                              Text('${day.day}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg)),
                              if (selected && !widget.single)
                                Container(padding: const EdgeInsets.symmetric(horizontal: 4), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)), child: Text('#${idx + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.dark))),
                              if (isToday && !selected) const Text('Today', style: TextStyle(fontSize: 10, color: AppColors.blue600, fontWeight: FontWeight.bold)),
                            ]),
                            if (isSunday) const Expanded(child: Center(child: Text('Sun', style: TextStyle(fontSize: 10, color: AppColors.error)))),
                          ]),
                        ),
                      ),
                    ),
                  );
                }),
            ],
          ),
        ]),
      ),
      if (!widget.single) ...[
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text.rich(TextSpan(children: [
                  const TextSpan(text: 'SELECTED EXAM DATES: ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.dark)),
                  TextSpan(text: '${sel.length}', style: TextStyle(fontWeight: FontWeight.bold, color: sel.length == widget.maxDates ? AppColors.primary : AppColors.amber600)),
                  TextSpan(text: ' / ${widget.maxDates} Required', style: const TextStyle(fontSize: 12, color: AppColors.dark)),
                ])),
              ),
              if (sel.length < widget.maxDates)
                Pill('Need ${widget.maxDates - sel.length} more', bg: AppColors.amber50, fg: AppColors.amber700)
              else
                const Pill('Ready to configure sessions', bg: AppColors.light, fg: AppColors.dark),
            ]),
            const SizedBox(height: 8),
            if (sel.isEmpty)
              const Text('Click on any weekday above to select exam dates, or use "Auto-Select" to pick consecutive working days.', style: TextStyle(fontSize: 13, color: AppColors.textSec, fontStyle: FontStyle.italic))
            else
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (var i = 0; i < sel.length; i++)
                  Container(
                    padding: const EdgeInsets.only(left: 8),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.border)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('#${i + 1} ', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primary)),
                      Text(formatDateWithDay(sel[i]), style: const TextStyle(fontSize: 13)),
                      IconButton(onPressed: () => widget.onToggle(sel[i]), icon: const Icon(Icons.close, size: 14), tooltip: 'Remove date', visualDensity: VisualDensity.compact),
                    ]),
                  ),
              ]),
          ]),
        ),
      ],
    ]);
  }
}
