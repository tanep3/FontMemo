import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_SIZES, GUIDE_MARKS, dotsPerMmForWidth, guideLengthPx, printBandPx } from "../src/core/guides";

test("paper sizes: A and B series with portrait width/height", () => {
  assert.deepEqual(
    PAPER_SIZES.map((g) => [g.label, g.series, g.widthMm, g.heightMm]),
    [
      ["A6", "A", 105, 148],
      ["B6", "B", 128, 182],
      ["A5", "A", 148, 210],
      ["B5", "B", 182, 257],
      ["A4", "A", 210, 297],
      ["B4", "B", 257, 364],
    ],
  );
});

test("guide marks cover both sides of every size, nested labels combined", () => {
  assert.deepEqual(
    GUIDE_MARKS.map((m) => [m.mm, m.series, m.text]),
    [
      [105, "A", "A6横"],
      [128, "B", "B6横"],
      [148, "A", "A6縦・A5横"],
      [182, "B", "B6縦・B5横"],
      [210, "A", "A5縦・A4横"],
      [257, "B", "B5縦・B4横"],
      [297, "A", "A4縦"],
      [364, "B", "B4縦"],
    ],
  );
});

test("dots per mm follows the width preset's printer class", () => {
  assert.ok(Math.abs(dotsPerMmForWidth(384) - 200 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(576) - 300 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(250) - 200 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(1000) - 300 / 25.4) < 1e-9);
});

test("print band is the paper width minus both margins", () => {
  assert.deepEqual(printBandPx(384, 16), { startPx: 16, endPx: 368 });
  assert.deepEqual(printBandPx(576, 0), { startPx: 0, endPx: 576 });
  // An over-large margin never inverts the band.
  assert.deepEqual(printBandPx(384, 300), { startPx: 300, endPx: 300 });
});

test("guide lengths scale with resolution for the same physical size", () => {
  const at200 = guideLengthPx(297, 384);
  const at300 = guideLengthPx(297, 576);
  assert.ok(Math.abs(at200 - 297 * (200 / 25.4)) < 1e-6);
  assert.ok(Math.abs(at300 / at200 - 1.5) < 1e-9);
});
