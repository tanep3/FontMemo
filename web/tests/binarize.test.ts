import { test } from "node:test";
import assert from "node:assert/strict";
import { otsuThreshold } from "../src/core/binarize";

test("bimodal black/white splits at the valley", () => {
  const lum = new Uint8ClampedArray(200);
  lum.fill(255, 100);
  const t = otsuThreshold(lum);
  assert.ok(t >= 0 && t < 255);
  // With the returned threshold, 0 is ink and 255 is paper.
  assert.ok(0 <= t);
  assert.ok(255 > t);
});

test("two gray levels split between them", () => {
  const lum = new Uint8ClampedArray(100);
  lum.fill(100, 0, 50);
  lum.fill(200, 50);
  const t = otsuThreshold(lum);
  assert.ok(t >= 100 && t < 200);
});

test("a uniform image has no threshold (binarization is skipped)", () => {
  const lum = new Uint8ClampedArray(64).fill(128);
  assert.equal(otsuThreshold(lum), -1);
});

test("an empty image has no threshold", () => {
  assert.equal(otsuThreshold(new Uint8ClampedArray(0)), -1);
});
