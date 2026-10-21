import 'package:flutter/material.dart';

import '../../controllers/workspace_controller.dart';
import '../../core/format.dart';
import '../../core/theme.dart';

/// Shared building blocks of every screen.

final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

void toast(String message, {bool error = false, int seconds = 3}) {
  scaffoldMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: Colors.white, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(message)),
      ]),
      backgroundColor: error ? AppColors.red600 : AppColors.dark,
      behavior: SnackBarBehavior.floating,
      width: 520,
      duration: Duration(seconds: error ? seconds + 3 : seconds),
    ));
}

void showOutcome(Outcome? o) {
  if (o != null) toast(o.message, error: o.error);
}

class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.color, this.borderColor, this.onTap, this.selected = false});
  final Widget child;
  final EdgeInsets padding;
  final Color? color, borderColor;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final box = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: selected ? AppColors.primary : (borderColor ?? AppColors.border), width: selected ? 2 : 1),
        boxShadow: const [BoxShadow(color: Color(0x0D000000), blurRadius: 3, offset: Offset(0, 1))],
      ),
      child: child,
    );
    if (onTap == null) return box;
    return MouseRegion(cursor: SystemMouseCursors.click, child: GestureDetector(onTap: onTap, child: box));
  }
}

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, this.icon, this.onPressed, this.loading = false, this.color});
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;
  final Color? color;
  @override
  Widget build(BuildContext context) => ElevatedButton(
        onPressed: loading ? null : onPressed,
        style: color == null ? null : ElevatedButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (loading) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) else if (icon != null) Icon(icon, size: 18),
          if (icon != null || loading) const SizedBox(width: 8),
          Text(label),
        ]),
      );
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, this.icon, this.onPressed, this.danger = false});
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool danger;
  @override
  Widget build(BuildContext context) => OutlinedButton(
        onPressed: onPressed,
        style: danger ? OutlinedButton.styleFrom(foregroundColor: AppColors.red600) : null,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
          Text(label),
        ]),
      );
}

class LinkButton extends StatelessWidget {
  const LinkButton(this.label, {super.key, this.onPressed, this.color = AppColors.primary});
  final String label;
  final VoidCallback? onPressed;
  final Color color;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onPressed,
        child: Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text(label, style: TextStyle(fontSize: 13, color: onPressed == null ? AppColors.gray400 : color, fontWeight: FontWeight.w500))),
      );
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (status) {
      'draft' => (AppColors.yellow100, AppColors.yellow800),
      'confirmed' => (AppColors.blue100, AppColors.blue800),
      'published' => (AppColors.light, AppColors.dark),
      _ => (AppColors.gray100, AppColors.gray700),
    };
    return Pill(capitalize(status), bg: bg, fg: fg);
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, required this.bg, required this.fg, this.bold = false});
  final String text;
  final Color bg, fg;
  final bool bold;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
        child: Text(text, style: TextStyle(fontSize: 12.5, color: fg, fontWeight: bold ? FontWeight.w700 : FontWeight.w600)),
      );
}

class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.subtitle, this.actions = const []});
  final String title;
  final String? subtitle;
  final List<Widget> actions;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 24),
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          runSpacing: 12,
          spacing: 16,
          children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.bold, color: AppColors.textMain)),
              if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle!, style: const TextStyle(color: AppColors.textSec, fontSize: 15))),
            ]),
            if (actions.isNotEmpty) Wrap(spacing: 8, runSpacing: 8, children: actions),
          ],
        ),
      );
}

enum BannerKind { error, warning, success, info }

class MessageBanner extends StatelessWidget {
  const MessageBanner({super.key, required this.kind, this.title, this.lines = const [], this.trailing});
  final BannerKind kind;
  final String? title;
  final List<String> lines;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final (bg, border, fg, icon) = switch (kind) {
      BannerKind.error => (AppColors.red50, AppColors.red200, AppColors.red700, Icons.warning_amber_rounded),
      BannerKind.warning => (AppColors.amber50, AppColors.amber200, AppColors.amber800, Icons.warning_amber_rounded),
      BannerKind.success => (AppColors.green50, AppColors.green200, AppColors.green700, Icons.check_circle_outline),
      BannerKind.info => (AppColors.sky50, AppColors.sky200, AppColors.sky700, Icons.info_outline),
    };
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, border: Border.all(color: border), borderRadius: BorderRadius.circular(12)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: fg),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null) Text(title!, style: TextStyle(fontWeight: FontWeight.w700, color: fg)),
            for (final l in lines) Padding(padding: const EdgeInsets.only(top: 3), child: Text(l, style: TextStyle(color: fg, fontSize: 13.5))),
          ]),
        ),
        if (trailing != null) ...[const SizedBox(width: 10), trailing!],
      ]),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle, this.action});
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;
  @override
  Widget build(BuildContext context) => AppCard(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: Center(
            child: Column(children: [
              Icon(icon, size: 44, color: AppColors.gray300),
              const SizedBox(height: 12),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.textSec, fontSize: 15)),
              if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSec, fontSize: 13.5))),
              if (action != null) Padding(padding: const EdgeInsets.only(top: 14), child: action!),
            ]),
          ),
        ),
      );
}

/// A table in a card: a grey header row and divided rows. Columns size by flex, or fixed width.
class DataTableCard extends StatelessWidget {
  const DataTableCard({super.key, required this.columns, required this.rows, this.flex, this.footer, this.empty, this.rowColor, this.minWidth = 760, this.onRowTap});
  final List<String> columns;
  final List<List<Widget>> rows;
  final List<double>? flex;
  final Widget? footer;
  final String? empty;
  final Color? Function(int i)? rowColor;
  final double minWidth;
  final void Function(int i)? onRowTap;

  @override
  Widget build(BuildContext context) {
    Widget row(List<Widget> cells, {bool head = false, Color? color, VoidCallback? onTap}) {
      final r = Container(
        color: head ? AppColors.gray50 : color,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          for (var i = 0; i < cells.length; i++) Expanded(flex: ((flex != null && i < flex!.length ? flex![i] : 1) * 10).round(), child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: cells[i])),
        ]),
      );
      return onTap == null ? r : InkWell(onTap: onTap, child: r);
    }

    return AppCard(
      padding: EdgeInsets.zero,
      child: LayoutBuilder(builder: (context, c) {
        final w = c.maxWidth < minWidth ? minWidth : c.maxWidth;
        final table = SizedBox(
          width: w,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
              child: row([for (final h in columns) Text(h.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSec, letterSpacing: 0.5))], head: true),
            ),
            const Divider(),
            if (rows.isEmpty && empty != null) Padding(padding: const EdgeInsets.all(40), child: Center(child: Text(empty!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSec)))),
            for (var i = 0; i < rows.length; i++) ...[
              row(rows[i], color: rowColor?.call(i), onTap: onRowTap == null ? null : () => onRowTap!(i)),
              if (i < rows.length - 1) const Divider(),
            ],
            if (footer != null) ...[const Divider(), Container(color: AppColors.gray50, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: footer)],
          ]),
        );
        return c.maxWidth < minWidth ? SingleChildScrollView(scrollDirection: Axis.horizontal, child: table) : table;
      }),
    );
  }
}

TextStyle get monoSmall => const TextStyle(fontFamily: 'Consolas', fontSize: 13);
TextStyle get cellSec => const TextStyle(color: AppColors.textSec, fontSize: 14);

class ActiveStatus extends StatelessWidget {
  const ActiveStatus(this.active, {super.key});
  final bool active;
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(active ? Icons.check_circle_outline : Icons.cancel_outlined, size: 15, color: active ? AppColors.green600 : AppColors.error),
        const SizedBox(width: 4),
        Text(active ? 'Active' : 'Inactive', style: TextStyle(fontSize: 13, color: active ? AppColors.green600 : AppColors.error)),
      ]);
}

/// A labelled form field.
class Field extends StatelessWidget {
  const Field({super.key, required this.label, required this.child});
  final String label;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.textMain)),
        const SizedBox(height: 6),
        child,
      ]);
}

class SearchField extends StatelessWidget {
  const SearchField({super.key, required this.hint, required this.onChanged, this.controller, this.autofocus = false});
  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final bool autofocus;
  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        autofocus: autofocus,
        onChanged: onChanged,
        decoration: InputDecoration(hintText: hint, prefixIcon: const Icon(Icons.search, size: 20)),
      );
}

/// A dropdown of values with labels; null is the "all / none" choice.
class Select<T> extends StatelessWidget {
  const Select({super.key, required this.value, required this.items, required this.onChanged, this.hint = '— Select —', this.width});
  final T? value;
  final List<(T, String)> items;
  final ValueChanged<T?>? onChanged;
  final String hint;
  final double? width;
  @override
  Widget build(BuildContext context) {
    final field = DropdownButtonFormField<T?>(
      value: items.any((i) => i.$1 == value) ? value : null,
      isExpanded: true,
      items: [DropdownMenuItem<T?>(value: null, child: Text(hint, overflow: TextOverflow.ellipsis)), for (final i in items) DropdownMenuItem<T?>(value: i.$1, child: Text(i.$2, overflow: TextOverflow.ellipsis))],
      onChanged: onChanged,
    );
    return width == null ? field : SizedBox(width: width, child: field);
  }
}

/// A dialog frame: title bar with close button, scrolling body, footer of actions.
class ModalShell extends StatelessWidget {
  const ModalShell({super.key, required this.title, this.subtitle, required this.child, this.actions = const [], this.maxWidth = 520, this.leadingIcon, this.iconColor, this.fullHeight = false, this.footerLeading});
  final String title;
  final String? subtitle;
  final Widget child;
  final List<Widget> actions;
  final double maxWidth;
  final IconData? leadingIcon;
  final Color? iconColor;
  final bool fullHeight;
  final Widget? footerLeading;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: size.height * 0.92),
        child: SizedBox(
          height: fullHeight ? size.height * 0.92 : null,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              padding: const EdgeInsets.fromLTRB(22, 14, 10, 14),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.border))),
              child: Row(children: [
                if (leadingIcon != null) ...[
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(color: (iconColor ?? AppColors.primary).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                    child: Icon(leadingIcon, size: 18, color: iconColor ?? AppColors.primary),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                    if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
                  ]),
                ),
                IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close, size: 20), tooltip: 'Close'),
              ]),
            ),
            if (fullHeight) Expanded(child: child) else Flexible(child: child),
            if (actions.isNotEmpty || footerLeading != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
                decoration: const BoxDecoration(color: AppColors.gray50, border: Border(top: BorderSide(color: AppColors.border))),
                child: Row(children: [
                  if (footerLeading != null) Expanded(child: footerLeading!) else const Spacer(),
                  Wrap(spacing: 8, runSpacing: 8, children: actions),
                ]),
              ),
          ]),
        ),
      ),
    );
  }
}

Future<bool> confirmDialog(BuildContext context, String message, {String title = 'Please confirm', String confirmLabel = 'OK', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
      content: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 460), child: Text(message)),
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        ElevatedButton(
          onPressed: () => Navigator.pop(ctx, true),
          style: danger ? ElevatedButton.styleFrom(backgroundColor: AppColors.red600) : null,
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return r == true;
}

/// Shows the result of an Excel import: how many were saved and why rows were skipped.
Future<void> showImportResult(BuildContext context, {required bool success, String? error, required int inserted, required List<({int row, String reason})> issues, required String what, String? missingNote}) {
  return showDialog(
    context: context,
    builder: (ctx) => ModalShell(
      title: success ? 'Import Complete' : 'Import Failed',
      maxWidth: 560,
      actions: [ElevatedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!success) ...[
            Text(error ?? 'The file could not be imported.', style: const TextStyle(color: AppColors.red600)),
            if (missingNote != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(missingNote, style: const TextStyle(fontSize: 13, color: AppColors.textSec))),
          ] else ...[
            Text(what, style: const TextStyle(color: AppColors.green600, fontWeight: FontWeight.w600)),
            if (issues.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('${issues.length} row(s) skipped or noted — here\'s why:', style: const TextStyle(color: AppColors.textSec)),
              const SizedBox(height: 8),
              Container(
                decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(8)),
                child: Column(children: [
                  for (var i = 0; i < issues.length; i++) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Row ${issues[i].row}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        const SizedBox(width: 12),
                        Expanded(child: Text(issues[i].reason, textAlign: TextAlign.right, style: const TextStyle(color: AppColors.error, fontSize: 13))),
                      ]),
                    ),
                    if (i < issues.length - 1) const Divider(),
                  ]
                ]),
              ),
            ],
          ],
        ]),
      ),
    ),
  );
}

/// A small chip-like toggle button.
class ToggleChip extends StatelessWidget {
  const ToggleChip({super.key, required this.label, required this.on, required this.onTap, this.onColor = AppColors.primary, this.tooltip});
  final String label;
  final bool on;
  final VoidCallback onTap;
  final Color onColor;
  final String? tooltip;
  @override
  Widget build(BuildContext context) {
    final chip = InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: on ? onColor : Colors.white, border: Border.all(color: on ? onColor : AppColors.border), borderRadius: BorderRadius.circular(6)),
        child: Text(label, style: TextStyle(fontSize: 13, color: on ? Colors.white : AppColors.textMain)),
      ),
    );
    return tooltip == null ? chip : Tooltip(message: tooltip!, child: chip);
  }
}

/// A time-of-day field ("09:30") with a clock picker.
class TimeField extends StatelessWidget {
  const TimeField({super.key, required this.value, required this.onChanged, this.label});
  final String value;
  final ValueChanged<String> onChanged;
  final String? label;
  @override
  Widget build(BuildContext context) {
    final field = InkWell(
      onTap: () async {
        final parts = value.split(':');
        final t = await showTimePicker(
          context: context,
          initialTime: TimeOfDay(hour: int.tryParse(parts.first) ?? 9, minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0),
          builder: (ctx, child) => MediaQuery(data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: false), child: child!),
        );
        if (t != null) onChanged('${pad2(t.hour)}:${pad2(t.minute)}');
      },
      child: InputDecorator(
        decoration: const InputDecoration(suffixIcon: Icon(Icons.schedule, size: 18)),
        child: Text(value.isEmpty ? '—' : formatTime12h(value), style: const TextStyle(fontSize: 14)),
      ),
    );
    return label == null ? field : Field(label: label!, child: field);
  }
}
