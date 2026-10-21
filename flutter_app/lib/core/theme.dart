import 'package:flutter/material.dart';

/// The HIAS brand colours (same values as the Electron app's Tailwind theme).
class AppColors {
  static const primary = Color(0xFF059669);
  static const dark = Color(0xFF065F46);
  static const light = Color(0xFFD1FAE5);
  static const veryLight = Color(0xFFECFDF5);
  static const sidebar = Color(0xFF064E3B);
  static const textMain = Color(0xFF0A1F17);
  static const textSec = Color(0xFF476157);
  static const border = Color(0xFFDCEAE3);
  static const warning = Color(0xFFF59E0B);
  static const error = Color(0xFFEF4444);
  static const background = Color(0xFFF6FAF8);
  static const gold = Color(0xFFFDE68A);
  static const goldDeep = Color(0xFFD4A017);

  static const red50 = Color(0xFFFEF2F2);
  static const red200 = Color(0xFFFECACA);
  static const red600 = Color(0xFFDC2626);
  static const red700 = Color(0xFFB91C1C);
  static const amber50 = Color(0xFFFFFBEB);
  static const amber100 = Color(0xFFFEF3C7);
  static const amber200 = Color(0xFFFDE68A);
  static const amber600 = Color(0xFFD97706);
  static const amber700 = Color(0xFFB45309);
  static const amber800 = Color(0xFF92400E);
  static const green50 = Color(0xFFF0FDF4);
  static const green200 = Color(0xFFBBF7D0);
  static const green600 = Color(0xFF16A34A);
  static const green700 = Color(0xFF15803D);
  static const blue50 = Color(0xFFEFF6FF);
  static const blue100 = Color(0xFFDBEAFE);
  static const blue600 = Color(0xFF2563EB);
  static const blue800 = Color(0xFF1E40AF);
  static const yellow100 = Color(0xFFFEF9C3);
  static const yellow800 = Color(0xFF854D0E);
  static const sky50 = Color(0xFFF0F9FF);
  static const sky100 = Color(0xFFE0F2FE);
  static const sky200 = Color(0xFFBAE6FD);
  static const sky600 = Color(0xFF0284C7);
  static const sky700 = Color(0xFF0369A1);
  static const pink50 = Color(0xFFFDF2F8);
  static const pink100 = Color(0xFFFCE7F3);
  static const pink200 = Color(0xFFFBCFE8);
  static const pink600 = Color(0xFFDB2777);
  static const pink700 = Color(0xFFBE185D);
  static const violet50 = Color(0xFFF5F3FF);
  static const violet100 = Color(0xFFEDE9FE);
  static const violet200 = Color(0xFFDDD6FE);
  static const violet600 = Color(0xFF7C3AED);
  static const violet700 = Color(0xFF6D28D9);
  static const gray50 = Color(0xFFF9FAFB);
  static const gray100 = Color(0xFFF3F4F6);
  static const gray200 = Color(0xFFE5E7EB);
  static const gray300 = Color(0xFFD1D5DB);
  static const gray400 = Color(0xFF9CA3AF);
  static const gray500 = Color(0xFF6B7280);
  static const gray600 = Color(0xFF4B5563);
  static const gray700 = Color(0xFF374151);
}

/// Background / foreground pairs for class colours on the bench grid.
class ClassColor {
  final Color bg, fg;
  const ClassColor(this.bg, this.fg);
}

const classColorList = <ClassColor>[
  ClassColor(Color(0xFFE0F2FE), Color(0xFF075985)),
  ClassColor(Color(0xFFFEF3C7), Color(0xFF92400E)),
  ClassColor(Color(0xFFEDE9FE), Color(0xFF5B21B6)),
  ClassColor(Color(0xFFD1FAE5), Color(0xFF065F46)),
  ClassColor(Color(0xFFFFE4E6), Color(0xFF9F1239)),
  ClassColor(Color(0xFFE2E8F0), Color(0xFF1E293B)),
  ClassColor(Color(0xFFECFCCB), Color(0xFF3F6212)),
  ClassColor(Color(0xFFFFEDD5), Color(0xFF9A3412)),
  ClassColor(Color(0xFFCFFAFE), Color(0xFF155E75)),
  ClassColor(Color(0xFFFAE8FF), Color(0xFF86198F)),
  ClassColor(Color(0xFFFEF9C3), Color(0xFF854D0E)),
  ClassColor(Color(0xFFCCFBF1), Color(0xFF115E59)),
];

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary, primary: AppColors.primary, surface: Colors.white),
    scaffoldBackgroundColor: AppColors.background,
    fontFamily: 'Segoe UI',
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: AppColors.textMain, displayColor: AppColors.textMain),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppColors.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppColors.primary, width: 2)),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.5),
        disabledForegroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.textMain,
        backgroundColor: Colors.white,
        side: const BorderSide(color: AppColors.border),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
    checkboxTheme: CheckboxThemeData(fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.primary : null)),
    dividerTheme: const DividerThemeData(color: AppColors.border, space: 1, thickness: 1),
  );
}
