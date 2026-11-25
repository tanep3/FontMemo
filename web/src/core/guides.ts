// Paper-size guides for sideways printing (editor display only,
// never drawn into the print PNG). In sideways mode the editor's
// horizontal axis is the print length along the roll, so a dashed
// line at each paper size's landscape long side tells the user how
// long the print will be in familiar paper terms.

export interface PaperGuide {
  label: string;
  series: "A" | "B";
  /** Landscape (yoko) long side, in millimetres. */
  longSideMm: number;
}

/** Ascending by length: A6 < B6 < A5 < B5 < A4 < B4. */
export const PAPER_GUIDES_YOKO: readonly PaperGuide[] = [
  { label: "A6", series: "A", longSideMm: 148 },
  { label: "B6", series: "B", longSideMm: 182 },
  { label: "A5", series: "A", longSideMm: 210 },
  { label: "B5", series: "B", longSideMm: 257 },
  { label: "A4", series: "A", longSideMm: 297 },
  { label: "B4", series: "B", longSideMm: 364 },
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
export function guideLengthPx(longSideMm: number, paperWidthPx: number): number {
  return longSideMm * dotsPerMmForWidth(paperWidthPx);
}
