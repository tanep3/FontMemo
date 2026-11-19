import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStylePatch,
  mergeSegments,
  styleAtCp,
  type TextSegment,
} from "../src/core/runs";

test("mergeSegments joins adjacent equal styles", () => {
  const merged = mergeSegments([
    { text: "あ", style: {} },
    { text: "い", style: {} },
    { text: "う", style: { bold: true } },
    { text: "え", style: { bold: true } },
  ]);
  assert.deepEqual(merged, [
    { text: "あい", style: {} },
    { text: "うえ", style: { bold: true } },
  ]);
});

test("applyStylePatch splits at the range boundaries", () => {
  const segs: TextSegment[] = [{ text: "あいうえお", style: {} }];
  const next = applyStylePatch(segs, 1, 3, { fontRef: "bundled:x" });
  assert.deepEqual(next, [
    { text: "あ", style: {} },
    { text: "いう", style: { fontRef: "bundled:x" } },
    { text: "えお", style: {} },
  ]);
});

test("applyStylePatch with null clears a property", () => {
  const segs: TextSegment[] = [{ text: "あい", style: { bold: true } }];
  const next = applyStylePatch(segs, 0, 2, { bold: null });
  assert.deepEqual(next, [{ text: "あい", style: {} }]);
});

test("applyStylePatch across segment boundaries re-merges", () => {
  const segs: TextSegment[] = [
    { text: "あい", style: {} },
    { text: "うえ", style: { size: 64 } },
  ];
  const next = applyStylePatch(segs, 1, 3, { bold: true });
  assert.deepEqual(next, [
    { text: "あ", style: {} },
    { text: "い", style: { bold: true } },
    { text: "う", style: { size: 64, bold: true } },
    { text: "え", style: { size: 64 } },
  ]);
});

test("styleAtCp counts newlines as characters", () => {
  const segs: TextSegment[] = [
    { text: "A\n", style: {} },
    { text: "B", style: { italic: true } },
  ];
  assert.deepEqual(styleAtCp(segs, 0), {});
  assert.deepEqual(styleAtCp(segs, 2), { italic: true });
  assert.equal(styleAtCp(segs, 5), null);
});
