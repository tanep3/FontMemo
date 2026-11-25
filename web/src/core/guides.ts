// Paper-size guides (editor display only, never drawn into the
// print PNG). The guides mark, along the print-length axis, the
// side of each A/B sheet that runs along that axis:
//
// - Normal mode: the length axis is the sheet's vertical side
//   (縦の長さ), so the editor shows horizontal lines at each
//   heightMm from the top (print start edge).
// - Sideways mode: after rotation the length axis is the sheet's
//   horizontal side (横の長さ), so the editor shows vertical lines
//   at each widthMm from the left (print start edge).

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
