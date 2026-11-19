// Styled text layout (v0.2): wraps segments of mixed fonts and sizes
// with kinsoku rules, and lays out the sideways block. Measurement is
// injected per segment so the module stays testable outside the browser.

import type { CanvasCaps } from "./caps";
import { withinCaps } from "./caps";

export interface SegmentInput {
  text: string;
  sizePx: number;
  /** Full CSS font shorthand used for drawing this segment. */
  cssFont: string;
  measure: (text: string) => number;
  /** Index of the source segment (maps back to coverage info). */
  segId: number;
}

export interface LayoutOptions {
  lineHeightFactor: number;
  marginX: number;
  marginY: number;
  align: "left" | "center" | "right";
  /** Per-paragraph alignment overrides, indexed like the paragraphs
   *  formed by splitting the text on "\n"; missing entries use align. */
  paragraphAligns?: ReadonlyArray<"left" | "center" | "right" | undefined>;
  mode: "normal" | "sideways";
  paperWidth: number;
  caps: CanvasCaps;
  /** Height basis for empty lines. */
  baseSizePx: number;
}

export interface LineSegment {
  segId: number;
  text: string;
  x: number;
  width: number;
  sizePx: number;
  cssFont: string;
  cpStart: number;
}

export interface LayoutLine {
  /** Top of the line box, absolute (includes the top margin). */
  y: number;
  height: number;
  maxSize: number;
  cpStart: number;
  segments: LineSegment[];
  /** Global code-point index of each character in this line. */
  cpIndices: number[];
  /** Cumulative absolute x per character; length = cpIndices.length + 1. */
  charOffsets: number[];
}

export type LayoutResult =
  | {
      ok: true;
      width: number;
      height: number;
      finalWidth: number;
      finalHeight: number;
      lines: LayoutLine[];
    }
  | { ok: false; reason: "too-long" | "block-too-tall" };

// Characters that must not start a line (JIS X 4051 based, design §5.1).
const KINSOKU_START = new Set(
  Array.from("、。，．・：；！？゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼～∥｜…‥’”）〕］｝〉》」』】»ゎゐゑをんァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ"),
);
// Characters that must not end a line.
const KINSOKU_END = new Set(Array.from("（〔［｛〈《「『【«‘“"));

interface CharItem {
  ch: string;
  cp: number;
  segId: number;
  sizePx: number;
  cssFont: string;
  width: number;
}

function isAsciiWordChar(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/** Greedy wrap of one paragraph with kinsoku push-in / push-out. */
function wrapParagraph(chars: CharItem[], contentWidth: number): CharItem[][] {
  const lines: CharItem[][] = [];
  let current: CharItem[] = [];
  let currentWidth = 0;
  const widthOf = (arr: CharItem[]) => arr.reduce((a, c) => a + c.width, 0);

  let i = 0;
  while (i < chars.length) {
    const item = chars[i];
    // A space that would start a line is consumed by the break.
    if (item.ch === " " && current.length === 0) {
      i++;
      continue;
    }
    if (currentWidth + item.width <= contentWidth || current.length === 0) {
      current.push(item);
      currentWidth += item.width;
      i++;
      continue;
    }
    // The character does not fit on the current line.
    if (KINSOKU_START.has(item.ch)) {
      const overflow = currentWidth + item.width - contentWidth;
      if (overflow <= item.width && current.length >= 2) {
        const moved = current.pop() as CharItem;
        lines.push(current);
        current = [moved, item];
        currentWidth = widthOf(current);
        i++;
        continue;
      }
      if (overflow <= item.width) {
        current.push(item);
        currentWidth += item.width;
        i++;
        continue;
      }
    }
    // ASCII word protection: break at the last space instead of mid-word.
    if (
      isAsciiWordChar(item.ch) &&
      current.length > 0 &&
      isAsciiWordChar(current[current.length - 1].ch)
    ) {
      let spaceIdx = -1;
      for (let j = current.length - 1; j >= 0; j--) {
        if (current[j].ch === " ") {
          spaceIdx = j;
          break;
        }
      }
      if (spaceIdx > 0) {
        lines.push(current.slice(0, spaceIdx));
        current = current.slice(spaceIdx + 1);
        currentWidth = widthOf(current);
        continue; // retry the same character
      }
    }
    // Plain break; line-ending-prohibited characters move down too.
    const carry: CharItem[] = [];
    while (current.length > 1 && KINSOKU_END.has(current[current.length - 1].ch)) {
      carry.unshift(current.pop() as CharItem);
    }
    lines.push(current);
    current = carry;
    currentWidth = widthOf(current);
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

export function layoutText(segments: SegmentInput[], opts: LayoutOptions): LayoutResult {
  // Flatten to paragraphs of character items, tracking global cp indices
  // (newline characters consume an index but produce no glyph).
  const paragraphs: CharItem[][] = [];
  let para: CharItem[] = [];
  let cp = 0;
  const paraStarts: number[] = [0];
  for (const seg of segments) {
    for (const ch of seg.text) {
      if (ch === "\n") {
        paragraphs.push(para);
        para = [];
        cp++;
        paraStarts.push(cp);
        continue;
      }
      para.push({
        ch,
        cp,
        segId: seg.segId,
        sizePx: seg.sizePx,
        cssFont: seg.cssFont,
        width: Math.max(0, seg.measure(ch)),
      });
      cp++;
    }
  }
  paragraphs.push(para);

  const buildLine = (
    chars: CharItem[],
    y: number,
    lineX: number,
    cpStartFallback: number,
  ): LayoutLine => {
    const maxSize = chars.length > 0 ? Math.max(...chars.map((c) => c.sizePx)) : opts.baseSizePx;
    const height = Math.round(maxSize * opts.lineHeightFactor);
    const segs: LineSegment[] = [];
    const charOffsets: number[] = [];
    const cpIndices: number[] = [];
    let x = lineX;
    for (const c of chars) {
      charOffsets.push(x);
      cpIndices.push(c.cp);
      const last = segs[segs.length - 1];
      if (last && last.segId === c.segId) {
        last.text += c.ch;
        last.width += c.width;
      } else {
        segs.push({
          segId: c.segId,
          text: c.ch,
          x,
          width: c.width,
          sizePx: c.sizePx,
          cssFont: c.cssFont,
          cpStart: c.cp,
        });
      }
      x += c.width;
    }
    charOffsets.push(x);
    return {
      y,
      height,
      maxSize,
      cpStart: chars.length > 0 ? chars[0].cp : cpStartFallback,
      segments: segs,
      cpIndices,
      charOffsets,
    };
  };

  const lines: LayoutLine[] = [];
  let y = opts.marginY;

  if (opts.mode === "sideways") {
    // No wrapping: one line per paragraph; alignment across the block.
    const rawLines = paragraphs.map((p, idx) => ({ chars: p, start: paraStarts[idx] }));
    const blockWidth = Math.max(
      0,
      ...rawLines.map((l) => l.chars.reduce((a, c) => a + c.width, 0)),
    );
    for (const [lineIdx, raw] of rawLines.entries()) {
      const align = opts.paragraphAligns?.[lineIdx] ?? opts.align;
      const lineWidth = raw.chars.reduce((a, c) => a + c.width, 0);
      let x = opts.marginX;
      if (align === "center") x = opts.marginX + (blockWidth - lineWidth) / 2;
      else if (align === "right") x = opts.marginX + (blockWidth - lineWidth);
      const line = buildLine(raw.chars, y, x, raw.start);
      lines.push(line);
      y += line.height;
    }
    const width = Math.ceil(blockWidth) + opts.marginX * 2;
    const contentHeight = y + opts.marginY;
    if (contentHeight > opts.paperWidth) return { ok: false, reason: "block-too-tall" };
    // The block height IS the print width: the canvas is exactly
    // paperWidth tall (lines stack from the top margin, the rest stays
    // white), so the rotated image is exactly the paper width, the
    // same contract as normal mode's fixed width.
    const height = opts.paperWidth;
    if (!withinCaps(height, width, opts.caps)) return { ok: false, reason: "too-long" };
    return { ok: true, width, height, finalWidth: height, finalHeight: width, lines };
  }

  const contentWidth = Math.max(1, opts.paperWidth - opts.marginX * 2);
  paragraphs.forEach((p, idx) => {
    const align = opts.paragraphAligns?.[idx] ?? opts.align;
    const wrapped = wrapParagraph(p, contentWidth);
    for (const w of wrapped) {
      const lineWidth = w.reduce((a, c) => a + c.width, 0);
      let x = opts.marginX;
      if (align === "center") x = opts.marginX + Math.max(0, (contentWidth - lineWidth) / 2);
      else if (align === "right") x = opts.marginX + Math.max(0, contentWidth - lineWidth);
      const line = buildLine(w, y, x, paraStarts[idx]);
      lines.push(line);
      y += line.height;
    }
  });
  const width = opts.paperWidth;
  const height = y + opts.marginY;
  if (!withinCaps(width, height, opts.caps)) return { ok: false, reason: "too-long" };
  return { ok: true, width, height, finalWidth: width, finalHeight: height, lines };
}

// ---------- missing-glyph marks (design §5.2) ----------

export interface MissingMark {
  lineIndex: number;
  x: number;
  width: number;
  /** Bottom y of the line box (marks sit just under the glyphs). */
  y: number;
}

/**
 * Underline positions for characters missing from their segment's font.
 * `missingCp` holds global code-point indices. Coordinates come from
 * per-code-point measurement; kerning/ligature differences can shift
 * them slightly (documented v1 limitation).
 */
export function missingMarks(
  layout: Extract<LayoutResult, { ok: true }>,
  missingCp: ReadonlySet<number>,
): MissingMark[] {
  const marks: MissingMark[] = [];
  layout.lines.forEach((line, lineIndex) => {
    line.cpIndices.forEach((cpIdx, i) => {
      if (missingCp.has(cpIdx)) {
        marks.push({
          lineIndex,
          x: line.charOffsets[i],
          width: Math.max(2, line.charOffsets[i + 1] - line.charOffsets[i]),
          y: line.y + line.height - 2,
        });
      }
    });
  });
  return marks;
}
