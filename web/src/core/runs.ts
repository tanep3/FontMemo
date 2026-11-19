// Per-range text styling (v0.2): the editor holds styles as spans; this
// module is the shared model — a flat list of segments with partial
// style overrides over the base settings.

export interface RunStyle {
  /** Font choice ref ("bundled:..", "family:..", "device:.."). */
  fontRef?: string;
  /** Absolute print size in px (the base font size when unset). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

export interface TextSegment {
  text: string;
  style: RunStyle;
}

export function cpLength(text: string): number {
  return Array.from(text).length;
}

export function stylesEqual(a: RunStyle, b: RunStyle): boolean {
  return (
    a.fontRef === b.fontRef && a.size === b.size && a.bold === b.bold && a.italic === b.italic
  );
}

/** Merge adjacent segments with equal styles; drop empty segments. */
export function mergeSegments(segments: TextSegment[]): TextSegment[] {
  const out: TextSegment[] = [];
  for (const seg of segments) {
    if (seg.text === "") continue;
    const last = out[out.length - 1];
    if (last && stylesEqual(last.style, seg.style)) last.text += seg.text;
    else out.push({ text: seg.text, style: { ...seg.style } });
  }
  return out;
}

/** Style of the character at a code-point index (newlines count). */
export function styleAtCp(segments: TextSegment[], cpIndex: number): RunStyle | null {
  let pos = 0;
  for (const seg of segments) {
    const len = cpLength(seg.text);
    if (cpIndex < pos + len) return seg.style;
    pos += len;
  }
  return null;
}

/** Total code points across segments. */
export function totalCp(segments: TextSegment[]): number {
  return segments.reduce((acc, s) => acc + cpLength(s.text), 0);
}

/** A style patch: a null value removes that property from the range. */
export type StylePatch = Partial<Record<keyof RunStyle, string | number | boolean | null>>;

function applyPatch(style: RunStyle, patch: StylePatch): RunStyle {
  const next: Record<string, unknown> = { ...style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as RunStyle;
}

/**
 * Apply a style patch to the code-point range [start, end): segments are
 * split at the boundaries, the covered parts get the patched style, and
 * the result is re-merged.
 */
export function applyStylePatch(
  segments: TextSegment[],
  start: number,
  end: number,
  patch: StylePatch,
): TextSegment[] {
  if (end <= start) return mergeSegments(segments);
  const out: TextSegment[] = [];
  let pos = 0;
  for (const seg of segments) {
    const chars = Array.from(seg.text);
    const segStart = pos;
    const segEnd = pos + chars.length;
    pos = segEnd;
    if (segEnd <= start || segStart >= end) {
      out.push(seg);
      continue;
    }
    const from = Math.max(0, start - segStart);
    const to = Math.min(chars.length, end - segStart);
    if (from > 0) out.push({ text: chars.slice(0, from).join(""), style: seg.style });
    out.push({
      text: chars.slice(from, to).join(""),
      style: applyPatch(seg.style, patch),
    });
    if (to < chars.length) out.push({ text: chars.slice(to).join(""), style: seg.style });
  }
  return mergeSegments(out);
}
