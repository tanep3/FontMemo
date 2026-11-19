import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCmap, covers, missingChars } from "../src/fonts/cmap";

// Build minimal synthetic sfnt files so the parser is tested against
// hand-computed expectations, independent of any real font.

function u16be(v: number): [number, number] {
  return [(v >> 8) & 0xff, v & 0xff];
}
function u32be(v: number): [number, number, number, number] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

class Buf {
  bytes: number[] = [];
  u16(v: number) {
    this.bytes.push(...u16be(v));
  }
  i16(v: number) {
    this.bytes.push(...u16be(v & 0xffff));
  }
  u32(v: number) {
    this.bytes.push(...u32be(v));
  }
  tag(s: string) {
    for (const c of s) this.bytes.push(c.charCodeAt(0));
  }
  padTo(n: number) {
    while (this.bytes.length < n) this.bytes.push(0);
  }
  build(): ArrayBuffer {
    return new Uint8Array(this.bytes).buffer;
  }
}

/** sfnt with one cmap table whose content is supplied by the caller. */
function sfntWithCmap(cmap: Buf): ArrayBuffer {
  const cmapBytes = cmap.bytes.length;
  const out = new Buf();
  out.u32(0x00010000);
  out.u16(1); // numTables
  out.u16(0);
  out.u16(0);
  out.u16(0);
  out.tag("cmap");
  out.u32(0);
  out.u32(28); // cmap offset = 12 + 16
  out.u32(cmapBytes);
  out.bytes.push(...cmap.bytes);
  return out.build();
}

function cmapHeader(subOffset: number): Buf {
  const b = new Buf();
  b.u16(0); // version
  b.u16(1); // numTables
  b.u16(3); // platform
  b.u16(1); // encoding
  b.u32(subOffset);
  return b;
}

test("format 4: glyph id 0 means missing", () => {
  // Subtable at cmap+12. Segments: [0x41..0x43] via glyphIdArray [1,0,2],
  // plus the terminal [0xFFFF..0xFFFF].
  const sub = new Buf();
  sub.u16(4); // format
  sub.u16(0); // length (patched below, parser does not rely on it)
  sub.u16(0); // language
  sub.u16(4); // segCountX2 (2 segments)
  sub.u16(0);
  sub.u16(0);
  sub.u16(0);
  sub.u16(0x43); // endCode[0]
  sub.u16(0xffff); // endCode[1]
  sub.u16(0); // reservedPad
  sub.u16(0x41); // startCode[0]
  sub.u16(0xffff); // startCode[1]
  sub.i16(0); // idDelta[0]
  sub.i16(1); // idDelta[1]
  // idRangeOffset[0] must point from its own word to glyphIdArray:
  // glyphIdArray starts right after the two idRangeOffset words.
  sub.u16(4); // idRangeOffset[0]
  sub.u16(0); // idRangeOffset[1]
  sub.u16(1); // glyph for A
  sub.u16(0); // glyph for B -> missing
  sub.u16(2); // glyph for C
  const cmap = cmapHeader(12);
  cmap.bytes.push(...sub.bytes);
  const cov = parseCmap(sfntWithCmap(cmap));
  assert.ok(cov);
  assert.equal(covers(cov, 0x41), true);
  assert.equal(covers(cov, 0x42), false);
  assert.equal(covers(cov, 0x43), true);
  assert.deepEqual(missingChars(cov, "ABC"), ["B"]);
});

test("format 12: groups, and a group starting at glyph 0", () => {
  const sub = new Buf();
  sub.u16(12);
  sub.u16(0);
  sub.u32(28 + 24); // length
  sub.u32(0); // language
  sub.u32(2); // nGroups
  sub.u32(0x41); // group 1: A..B with glyphs starting at 0
  sub.u32(0x42);
  sub.u32(0);
  sub.u32(0x3042); // group 2: あ..う with glyphs starting at 5
  sub.u32(0x3044);
  sub.u32(5);
  const cmap = cmapHeader(12);
  cmap.bytes.push(...sub.bytes);
  const cov = parseCmap(sfntWithCmap(cmap));
  assert.ok(cov);
  assert.equal(covers(cov, 0x41), false); // A maps to glyph 0
  assert.equal(covers(cov, 0x42), true); // B maps to glyph 1
  assert.equal(covers(cov, 0x3042), true);
  assert.equal(covers(cov, 0x3044), true);
  assert.equal(covers(cov, 0x3045), false);
});

test("TTC: the first face is used", () => {
  // Reuse the format-4 font, wrapped in a TTC header (16 bytes).
  const sub = new Buf();
  sub.u16(4);
  sub.u16(0);
  sub.u16(0);
  sub.u16(4);
  sub.u16(0);
  sub.u16(0);
  sub.u16(0);
  sub.u16(0x43);
  sub.u16(0xffff);
  sub.u16(0);
  sub.u16(0x41);
  sub.u16(0xffff);
  sub.i16(0);
  sub.i16(1);
  sub.u16(4);
  sub.u16(0);
  sub.u16(7);
  sub.u16(8);
  sub.u16(9);
  const cmap = cmapHeader(12);
  cmap.bytes.push(...sub.bytes);
  const inner = new Uint8Array(sfntWithCmap(cmap));
  const ttc = new Buf();
  ttc.tag("ttcf");
  ttc.u32(0x00010000);
  ttc.u32(1); // numFonts
  ttc.u32(16); // offset of first font
  ttc.bytes.push(...inner);
  const cov = parseCmap(ttc.build());
  assert.ok(cov);
  assert.equal(covers(cov, 0x41), true);
  assert.equal(covers(cov, 0x42), true);
});

test("control characters are never reported missing (CRLF paste)", () => {
  const sub = new Buf();
  sub.u16(12);
  sub.u16(0);
  sub.u32(28 + 12);
  sub.u32(0);
  sub.u32(1);
  sub.u32(0x41); // A..C
  sub.u32(0x43);
  sub.u32(1);
  const cmap = cmapHeader(12);
  cmap.bytes.push(...sub.bytes);
  const cov = parseCmap(sfntWithCmap(cmap));
  assert.ok(cov);
  // Windows line endings (CR) and LF/TAB are not glyphs.
  assert.deepEqual(missingChars(cov, "A\r\nB\tC"), []);
  assert.deepEqual(missingChars(cov, "\r\n"), []);
});

test("garbage input yields null", () => {
  assert.equal(parseCmap(new Uint8Array([1, 2, 3]).buffer), null);
  assert.equal(parseCmap(new ArrayBuffer(0)), null);
});
