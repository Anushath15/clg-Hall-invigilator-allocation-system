/**
 * Colours for every PDF HIAS produces. The sheets are printed, often on a basic office printer,
 * where light greys and pale greens fade out. Text is pure black, secondary lines are dark grey,
 * table rules are dark, and header bands are dark enough for white lettering to print crisply.
 * (jsPDF greys run 0 = black to 255 = white; colours are [r, g, b].)
 */
export const INK = 0
export const INK_NOTE = 40
export const RULE: [number, number, number] = [60, 60, 60]
export const HEAD_GREEN: [number, number, number] = [18, 100, 50]
export const HEAD_DARK: [number, number, number] = [18, 59, 42]
export const HEAD_RED: [number, number, number] = [160, 28, 28]
/** Header row of a standard green table: dark band, bold white lettering. */
export const HEAD_GREEN_STYLE = { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" as const }
