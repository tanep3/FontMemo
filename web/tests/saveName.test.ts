import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSaveName } from "../src/core/saveName";

test("timestamped name, then -2 for a same-second repeat", () => {
  const when = new Date(2026, 10, 19, 17, 30, 5);
  assert.equal(nextSaveName(when), "fontmemo-20261119-173005.png");
  assert.equal(nextSaveName(when), "fontmemo-20261119-173005-2.png");
  assert.equal(nextSaveName(when), "fontmemo-20261119-173005-3.png");
});

test("a different second starts plain again", () => {
  const when = new Date(2026, 10, 19, 17, 30, 6);
  assert.equal(nextSaveName(when), "fontmemo-20261119-173006.png");
});
