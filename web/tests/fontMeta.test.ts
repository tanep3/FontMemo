import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFaceInfo } from "../src/fonts/fontMeta";

// Build a synthetic sfnt with head / OS/2 / name tables to test face
// parsing (family grouping + weight/italic detection) against
// hand-computed expectations.

function utf16be(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push((c >> 8) & 0xff, c & 0xff);
  }
  return out;
}

function buildFont(opts: {
  names: Array<[number, string]>; // [nameId, text] on platform 3 / lang en
  os2Weight?: number;
  fsSelection?: number;
  macStyle?: number;
}): ArrayBuffer {
  const head = new Uint8Array(54);
  const hv = new DataView(head.buffer);
  hv.setUint16(44, opts.macStyle ?? 0);

  const os2 = new Uint8Array(96);
  const ov = new DataView(os2.buffer);
  ov.setUint16(4, opts.os2Weight ?? 400);
  ov.setUint16(62, opts.fsSelection ?? 0x40);

  const strings: number[] = [];
  const records: number[] = [];
  for (const [nameId, text] of opts.names) {
    const bytes = utf16be(text);
    records.push(3, 1, 0x409, nameId, bytes.length, strings.length);
    strings.push(...bytes);
  }
  const name = new Uint8Array(6 + records.length * 2 + strings.length);
  const nv = new DataView(name.buffer);
  nv.setUint16(0, 0);
  nv.setUint16(2, opts.names.length);
  nv.setUint16(4, 6 + opts.names.length * 12);
  records.forEach((v, i) => nv.setUint16(6 + i * 2, v));
  name.set(strings, 6 + records.length * 2);

  const tables: Array<[string, Uint8Array]> = [
    ["OS/2", os2],
    ["head", head],
    ["name", name],
  ];
  const headerSize = 12 + tables.length * 16;
  let offset = headerSize;
  const entries: Array<[string, number, number]> = [];
  for (const [tag, data] of tables) {
    entries.push([tag, offset, data.length]);
    offset += data.length;
  }
  const out = new Uint8Array(offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, tables.length);
  entries.forEach(([tag, off, len], i) => {
    const at = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[at + j] = tag.charCodeAt(j);
    dv.setUint32(at + 8, off);
    dv.setUint32(at + 12, len);
  });
  for (const [tag, data] of tables) {
    const entry = entries.find((e) => e[0] === tag) as [string, number, number];
    out.set(data, entry[1]);
  }
  return out.buffer;
}

test("subfamily Bold wins over a lazy OS/2 weight of 400 (Tekitou case)", () => {
  const buf = buildFont({
    names: [
      [16, "適当ポエム"],
      [17, "Bold"],
      [1, "適当ポエム Bold"],
      [4, "適当ポエム Bold"],
    ],
    os2Weight: 400,
    fsSelection: 0x40,
  });
  assert.deepEqual(parseFaceInfo(buf), { family: "適当ポエム", weight: 700, italic: false });
});

test("family suffix is split when only ID 1 carries the style", () => {
  const buf = buildFont({
    names: [
      [1, "Foo Bold"],
      [2, "Regular"],
      [4, "Foo Bold"],
    ],
    os2Weight: 400,
  });
  assert.deepEqual(parseFaceInfo(buf), { family: "Foo", weight: 700, italic: false });
});

test("italic from the subfamily name", () => {
  const buf = buildFont({
    names: [
      [16, "Bar"],
      [17, "Italic"],
      [1, "Bar Italic"],
    ],
  });
  assert.deepEqual(parseFaceInfo(buf), { family: "Bar", weight: 400, italic: true });
});

test("OS/2 weight is used when no style words exist", () => {
  const buf = buildFont({
    names: [
      [1, "Baz"],
      [2, "Regular"],
    ],
    os2Weight: 300,
  });
  assert.deepEqual(parseFaceInfo(buf), { family: "Baz", weight: 300, italic: false });
});

test("plain regular face", () => {
  const buf = buildFont({
    names: [
      [1, "Qux"],
      [2, "Regular"],
    ],
  });
  assert.deepEqual(parseFaceInfo(buf), { family: "Qux", weight: 400, italic: false });
});
