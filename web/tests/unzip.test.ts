import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { extractFontCandidates, isZip, ZipLimitError } from "../src/fonts/unzip";

const FAKE_FONT = new Uint8Array([0x00, 0x01, 0x00, 0x00, 1, 2, 3, 4]);

test("isZip recognizes the PK signature", () => {
  assert.equal(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer), true);
  assert.equal(isZip(new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer), false);
});

test("font candidates are extracted, other files are ignored", async () => {
  const zip = zipSync({
    "font.ttf": FAKE_FONT,
    "readme.txt": new Uint8Array([104, 105]),
    "sub/dir/other.otf": FAKE_FONT,
  });
  const scan = await extractFontCandidates(zip);
  assert.equal(scan.entryCount, 3);
  assert.deepEqual(
    scan.candidates.map((c) => c.name).sort(),
    ["font.ttf", "sub/dir/other.otf"],
  );
});

test("a ZIP without fonts yields no candidates", async () => {
  const zip = zipSync({ "a.txt": new Uint8Array([1]) });
  const scan = await extractFontCandidates(zip);
  assert.equal(scan.candidates.length, 0);
});

test("a single oversized font is rejected before extraction", async () => {
  const big = new Uint8Array(33 * 1024 * 1024); // zeros: tiny when zipped
  const zip = zipSync({ "big.ttf": big });
  await assert.rejects(extractFontCandidates(zip), (e: unknown) => {
    assert.ok(e instanceof ZipLimitError);
    assert.equal(e.reason, "file-too-large");
    return true;
  });
});

test("too many candidates are rejected", async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < 33; i++) entries[`f${i}.ttf`] = FAKE_FONT;
  const zip = zipSync(entries);
  await assert.rejects(extractFontCandidates(zip), (e: unknown) => {
    assert.ok(e instanceof ZipLimitError);
    assert.equal(e.reason, "too-many-candidates");
    return true;
  });
});
