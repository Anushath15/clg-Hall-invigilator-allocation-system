import 'package:flutter/material.dart';

import '../../../controllers/workspace_controller.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/domain/validation.dart';
import '../../../models/entities.dart';
import '../../../services/cycle_service.dart';
import '../../widgets/calendar.dart';
import '../../widgets/common.dart';

/// Adds a session ([session] null) or reschedules one (date, slot and timings).
Future<void> showSessionDialog(BuildContext context, WorkspaceController c, {ExamSession? session}) =>
    showDialog(context: context, builder: (_) => _SessionDialog(c: c, session: session));

class _SessionDialog extends StatefulWidget {
  const _SessionDialog({required this.c, this.session});
  final WorkspaceController c;
  final ExamSession? session;
  @override
  State<_SessionDialog> createState() => _SessionDialogState();
}

class _SessionDialogState extends State<_SessionDialog> {
  late String date = widget.session?.examDate ?? '';
  late String type = widget.session?.sessionType ?? 'FN';
  late String report = widget.session?.reportingTime ?? '09:30';
  late String start = widget.session?.examStart ?? '10:00';
  late String end = widget.session?.examEnd ?? '13:00';

  bool get editing => widget.session != null;
  bool get duplicate => date.isNotEmpty && widget.c.sessions.any((s) => s.id != widget.session?.id && s.examDate == date && s.sessionType == type);
  bool get currentlyDuplicate => editing && widget.c.isDuplicate(widget.session!);

  void _preset(String p) => setState(() {
        if (p == 'fn') {
          type = 'FN';
          report = '09:30';
          start = '10:00';
          end = '13:00';
        } else if (p == 'an') {
          type = 'AN';
          report = '13:30';
          start = '14:00';
          end = '17:00';
        } else {
          report = '09:30';
          start = '10:00';
          end = '12:00';
        }
      });

  String get duration {
    final s = start.split(':').map(int.tryParse).toList(), e = end.split(':').map(int.tryParse).toList();
    if (s.length < 2 || e.length < 2 || s.contains(null) || e.contains(null)) return '';
    var mins = (e[0]! * 60 + e[1]!) - (s[0]! * 60 + s[1]!);
    if (mins < 0) mins += 24 * 60;
    final h = mins ~/ 60, m = mins % 60;
    if (h > 0 && m > 0) return '$h hr $m mins';
    if (h > 0) return '$h hr${h > 1 ? 's' : ''}';
    return '$m mins';
  }

  void _save() {
    if (duplicate) return toast('A ${type == 'FN' ? 'Forenoon (FN)' : 'Afternoon (AN)'} session already exists for $date.', error: true);
    if (date.isEmpty) return toast('Please choose an exam date.', error: true);
    if ((!editing || date != widget.session!.examDate) && isPastDate(date)) return toast(pastDateMessage, error: true);
    final p = validateSessionTimes(report, start, end);
    if (p != null) return toast(p, error: true);
    final data = SessionInput(examDate: date, sessionType: type, reportingTime: report, examStart: start, examEnd: end);
    final o = editing ? widget.c.updateSession(widget.session!.id, data) : widget.c.addSession(data);
    showOutcome(o);
    if (!o.error) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    final canDelete = editing && s!.status == 'pending';
    final picked = date.isEmpty ? null : parseIsoDate(date);
    return ModalShell(
      title: editing ? 'Edit Session Schedule & Timings' : 'Add Exam Session',
      subtitle: editing ? 'Session Step #${s!.rotationStep} · ${s.examDate} (${s.sessionType})' : 'Add one more exam date or slot to this batch',
      leadingIcon: Icons.calendar_month_outlined,
      maxWidth: 560,
      footerLeading: editing
          ? Align(
              alignment: Alignment.centerLeft,
              child: canDelete
                  ? TextButton.icon(
                      onPressed: () async {
                        if (!await confirmDialog(context, 'Are you sure you want to delete this session (${s.examDate} ${s.sessionType})?', danger: true, confirmLabel: 'Delete')) return;
                        final o = widget.c.deleteSession(s.id);
                        showOutcome(o);
                        if (!o.error && context.mounted) Navigator.pop(context);
                      },
                      icon: const Icon(Icons.delete_outline, size: 16, color: AppColors.red600),
                      label: const Text('Delete Session', style: TextStyle(color: AppColors.red600)),
                    )
                  : const Text('Cannot delete: session already active.', style: TextStyle(fontSize: 13, color: AppColors.textSec, fontStyle: FontStyle.italic)),
            )
          : null,
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        PrimaryButton(label: editing ? 'Save Schedule' : 'Add Session', icon: editing ? Icons.check_circle_outline : Icons.add, onPressed: duplicate || date.isEmpty ? null : _save),
      ],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (currentlyDuplicate)
            MessageBanner(kind: BannerKind.warning, title: 'Duplicate Session Detected', lines: [
              'This session currently has the identical date and slot (${s!.examDate} ${s.sessionType}) as another session in this cycle.',
              'Please pick a different date/slot below, or use the "Delete Session" button below to remove this duplicate.',
            ]),
          if (duplicate)
            MessageBanner(kind: BannerKind.error, title: 'Duplicate Schedule Error', lines: [
              'Another session is already scheduled for ${formatFullDate(date)} ($type). Each exam date can only have at most one FN and one AN session.'
            ]),
          const Text('QUICK TIMING PRESETS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSec, letterSpacing: 0.5)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            SecondaryButton(label: 'Standard FN (10:00–13:00)', onPressed: () => _preset('fn')),
            SecondaryButton(label: 'Standard AN (14:00–17:00)', onPressed: () => _preset('an')),
            SecondaryButton(label: '2-Hr Exam (10:00–12:00)', onPressed: () => _preset('2h')),
          ]),
          const SizedBox(height: 16),
          const Text('Exam Date *', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          ExamCalendar(single: true, selected: date.isEmpty ? const [] : [date], onToggle: (d) => setState(() => date = d)),
          if (picked != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(children: [
                Text(formatFullDate(date), style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.dark, fontSize: 13)),
                if (picked.weekday == DateTime.sunday) const Padding(padding: EdgeInsets.only(left: 8), child: Pill('Sunday (College Holiday)', bg: Color(0xFFFEE2E2), fg: AppColors.red700)),
              ]),
            ),
          const SizedBox(height: 16),
          const Text('Session Slot *', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Row(children: [
            for (final t in const [('FN', 'FN — Forenoon'), ('AN', 'AN — Afternoon')]) ...[
              Expanded(
                child: InkWell(
                  onTap: () => setState(() => type = t.$1),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: type == t.$1 ? AppColors.primary : Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: type == t.$1 ? AppColors.primary : AppColors.border)),
                    child: Text(t.$2, style: TextStyle(fontWeight: FontWeight.w600, color: type == t.$1 ? Colors.white : AppColors.textMain)),
                  ),
                ),
              ),
              if (t.$1 == 'FN') const SizedBox(width: 12),
            ]
          ]),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                const Icon(Icons.schedule, size: 16, color: AppColors.primary),
                const SizedBox(width: 6),
                const Expanded(child: Text('MANUAL TIMINGS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.dark))),
                if (duration.isNotEmpty) Pill('Exam Duration: $duration', bg: Colors.white, fg: AppColors.primary),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TimeField(label: 'Report Time', value: report, onChanged: (v) => setState(() => report = v))),
                const SizedBox(width: 10),
                Expanded(child: TimeField(label: 'Exam Start', value: start, onChanged: (v) => setState(() => start = v))),
                const SizedBox(width: 10),
                Expanded(child: TimeField(label: 'Exam End', value: end, onChanged: (v) => setState(() => end = v))),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}
