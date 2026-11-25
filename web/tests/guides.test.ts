import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_GUIDES_YOKO, dotsPerMmForWidth, guideLengthPx } from "../src/core/guides";

test("yoko long sides: A and B series, ascending", () => {
  assert.deepEqual(
    PAPER_GUIDES_YOKO.map((g) => [g.label, g.series, g.longSideMm]),
    [
      ["A6", "A", 148],
      ["B6", "B", 182],
      ["A5", "A", 210],
      ["B5", "B", 257],
      ["A4", "A", 297],
      ["B4", "B", 364],
    ],
  );
});

test("dots per mm follows the width preset's printer class", () => {
  assert.ok(Math.abs(dotsPerMmForWidth(384) - 200 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(576) - 300 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(250) - 200 / 25.4) < 1e-9);
  assert.ok(Math.abs(dotsPerMmForWidth(1000) - 300 / 25.4) < 1e-9);
});

test("guide lengths scale with resolution for the same physical size", () => {
  const at200 = guideLengthPx(297, 384);
  const at300 = guideLengthPx(297, 576);
  assert.ok(Math.abs(at200 - 297 * (200 / 25.4)) < 1e-6);
  assert.ok(Math.abs(at300 / at200 - 1.5) < 1e-9);
});
