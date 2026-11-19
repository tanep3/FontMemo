// Rendering (v0.2): draw each laid-out segment with its own font on a
// shared baseline, then (sideways mode) rotate the finished canvas 90
// degrees clockwise so the head of the text leaves the printer first.

import type { LayoutResult } from "./layout";

/** Draw the text onto a fresh canvas in reading orientation. */
export function renderCanvas(layout: Extract<LayoutResult, { ok: true }>): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-2d-unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    // Shared baseline: the line's largest face sits centered in the box.
    const baseline = line.y + (line.height - line.maxSize) / 2 + line.maxSize * 0.88;
    for (const seg of line.segments) {
      ctx.font = seg.cssFont;
      ctx.fillText(seg.text, seg.x, baseline);
    }
  }
  return canvas;
}

/** Rotate a canvas 90 degrees clockwise (exact pixel permutation). */
export function rotate90CW(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = src.height;
  dst.height = src.width;
  const ctx = dst.getContext("2d");
  if (!ctx) throw new Error("canvas-2d-unavailable");
  ctx.imageSmoothingEnabled = false;
  ctx.translate(dst.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return dst;
}
