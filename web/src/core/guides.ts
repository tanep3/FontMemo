// Paper-size guides (editor display only, never drawn into the
// print PNG). Along the print-length axis the editor marks BOTH
// sides of each A/B sheet — the horizontal （横） and the vertical
// （縦） lengths — in both print modes: horizontal lines in normal
// mode, vertical lines in sideways mode, measured from the print
// start edge. A separate green pair of lines marks the print-area
// band across the paper width (inside the margins) in both modes.

export interface PaperSize {
  label: string;
  series: "A" | "B";
  /** 横の長さ: the portrait width, in millimetres. */
  widthMm: number;
  /** 縦の長さ: the portrait height, in millimetres. */
  heightMm: number;
}

/** Ascending by size: A6 < B6 < A5 < B5 < A4 < B4. */
export const PAPER_SIZES: readonly PaperSize[] = [
  { label: "A6", series: "A", widthMm: 105, heightMm: 148 },
  { label: "B6", series: "B", widthMm: 128, heightMm: 182 },
  { label: "A5", series: "A", widthMm: 148, heightMm: 210 },
  { label: "B5", series: "B", widthMm: 182, heightMm: 257 },
  { label: "A4", series: "A", widthMm: 210, heightMm: 297 },
  { label: "B4", series: "B", widthMm: 257, heightMm: 364 },
];

/**
 * Print resolution for a paper-width preset. The app's presets pair
 * width with a printer class — 384px is the 200dpi class, 576px the
 * 300dpi class — and the length direction uses the same resolution.
 * Custom widths follow the same split at 500px.
 */
export function dotsPerMmForWidth(paperWidthPx: number): number {
  return (paperWidthPx >= 500 ? 300 : 200) / 25.4;
}

/** Length along the roll, in print pixels, for a size in millimetres. */
export function guideLengthPx(mm: number, paperWidthPx: number): number {
  return mm * dotsPerMmForWidth(paperWidthPx);
}

export interface GuideMark {
  mm: number;
  series: "A" | "B";
  /** Combined label, e.g. "A6縦・A5横" where two sides coincide. */
  text: string;
}

/**
 * Every distinct length the sheet sides take, ascending, as marks
 * along the print-length axis — BOTH the horizontal （横） and the
 * vertical （縦） sides, in both print modes. The sides nest within a
 * series (A5's width is A6's height, and so on), so each mark belongs
 * to one series and carries a combined label where two sides share
 * the same length.
 */
export const GUIDE_MARKS: readonly GuideMark[] = (() => {
  const byMm = new Map<number, { series: "A" | "B"; parts: string[] }>();
  for (const s of PAPER_SIZES) {
    for (const [mm, kind] of [
      [s.widthMm, "横"],
      [s.heightMm, "縦"],
    ] as const) {
      const entry = byMm.get(mm) ?? { series: s.series, parts: [] };
      entry.parts.push(`${s.label}${kind}`);
      byMm.set(mm, entry);
    }
  }
  return [...byMm.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mm, e]) => ({ mm, series: e.series, text: e.parts.join("・") }));
})();

/**
 * The usable band across the paper width, in print pixels: from the
 * top/bottom margin to its mirror on the far side. In sideways mode
 * the editor draws this band's two edges as green dashed lines, so
 * changing the margin setting moves the lines.
 */
export function printBandPx(
  paperWidthPx: number,
  marginPx: number,
): { startPx: number; endPx: number } {
  return { startPx: marginPx, endPx: Math.max(marginPx, paperWidthPx - marginPx) };
}
