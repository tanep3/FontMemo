import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutText, missingMarks, type LayoutOptions, type SegmentInput } from "../src/core/layout";

// Fake metrics: ASCII = 5px, everything else = 10px, per code point.
const measure = (s: string) =>
  Array.from(s).reduce((acc, ch) => acc + (ch.codePointAt(0)! < 0x80 ? 5 : 10), 0);

const seg = (text: string, sizePx = 20, segId = 0): SegmentInput => ({
  text,
  sizePx,
  cssFont: "test",
  measure,
  segId,
});

const base: LayoutOptions = {
  lineHeightFactor: 1.5,
  marginX: 10,
  marginY: 10,
  align: "left",
  mode: "normal",
  paperWidth: 100, // content width 80
  caps: { maxLongSide: 8192, maxArea: 8192 * 8192 },
  baseSizePx: 20,
};

function linesOf(text: string, opts: Partial<LayoutOptions> = {}): string[] {
  const r = layoutText([seg(text)], { ...base, ...opts });
  assert.ok(r.ok);
  return r.lines.map((l) => l.segments.map((s) => s.text).join(""));
}

test("greedy wrap at the content width", () => {
  assert.deepEqual(linesOf("あああああああああ"), ["ああああああああ", "あ"]);
});

test("explicit newlines and empty paragraphs are preserved", () => {
  assert.deepEqual(linesOf("あい\n\nう"), ["あい", "", "う"]);
});

test("kinsoku start: push-out when the line is full", () => {
  assert.deepEqual(linesOf("ああああああああ、い"), ["あああああああ", "あ、い"]);
});

test("kinsoku start: push-in when the line has a single character", () => {
  assert.deepEqual(linesOf("あ、", { paperWidth: 35 }), ["あ、"]);
});

test("kinsoku end: an opening bracket moves down with the break", () => {
  assert.deepEqual(linesOf("ああああああ「あ", { paperWidth: 90 }), ["ああああああ", "「あ"]);
});

test("ASCII words are not split when a space is available", () => {
  assert.deepEqual(linesOf("aaa bbbbbb", { paperWidth: 60 }), ["aaa", "bbbbbb"]);
});

test("charOffsets are absolute and cumulative", () => {
  const r = layoutText([seg("あい")], base);
  assert.ok(r.ok);
  assert.deepEqual(r.lines[0].charOffsets, [10, 20, 30]);
  assert.equal(r.lines[0].segments[0].x, 10);
  assert.equal(r.lines[0].segments[0].width, 20);
  assert.deepEqual(r.lines[0].cpIndices, [0, 1]);
});

test("center alignment offsets the line", () => {
  const r = layoutText([seg("あい")], { ...base, align: "center" });
  assert.ok(r.ok);
  assert.equal(r.lines[0].segments[0].x, 10 + (80 - 20) / 2);
});

test("mixed sizes: the line height follows the largest segment", () => {
  const r = layoutText([seg("あ", 20, 0), seg("い", 40, 1)], base);
  assert.ok(r.ok);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].maxSize, 40);
  assert.equal(r.lines[0].height, 60);
  assert.equal(r.lines[0].segments.length, 2);
  assert.equal(r.lines[0].segments[1].x, 20);
  assert.equal(r.height, 60 + 20);
});

test("sideways: block taller than the paper width is rejected", () => {
  const r = layoutText([seg("あ\nい\nう")], {
    ...base,
    mode: "sideways",
    paperWidth: 100, // block height = 3*30 + 20 = 110 > 100
  });
  assert.deepEqual(r, { ok: false, reason: "block-too-tall" });
});

test("sideways: final size is the rotated size", () => {
  const r = layoutText([seg("あい\nう")], { ...base, mode: "sideways", paperWidth: 120 });
  assert.ok(r.ok);
  assert.equal(r.height, 2 * 30 + 20);
  assert.equal(r.finalWidth, r.height);
  assert.equal(r.finalHeight, r.width);
  assert.equal(r.width, 20 + 20);
});

test("caps: an over-long image is rejected, not truncated", () => {
  const r = layoutText([seg("あ")], { ...base, caps: { maxLongSide: 50, maxArea: 100000 } });
  assert.deepEqual(r, { ok: false, reason: "too-long" });
});

test("missingMarks positions come from charOffsets", () => {
  const r = layoutText([seg("あいう")], base);
  assert.ok(r.ok);
  const marks = missingMarks(r, new Set([1]));
  assert.equal(marks.length, 1);
  assert.equal(marks[0].lineIndex, 0);
  assert.equal(marks[0].x, 20);
  assert.equal(marks[0].width, 10);
  assert.equal(marks[0].y, 10 + 30 - 2);
});

test("missingMarks: cp indices account for the newline between paragraphs", () => {
  const r = layoutText([seg("A\nB")], base);
  assert.ok(r.ok);
  const marks = missingMarks(r, new Set([2])); // 'B' is cp 2 (A=0, \n=1)
  assert.equal(marks.length, 1);
  assert.equal(marks[0].lineIndex, 1);
});
