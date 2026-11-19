// cmap parsing for imported fonts (design §2, FR-02).
// Coverage lists only code points whose glyph ID is not 0 (.notdef).

export type Coverage = Array<readonly [number, number]>;

/** Big-endian binary reader over a font file (shared with fontMeta.ts). */
export interface BinLike {
  readonly byteLength: number;
  u16(off: number): number;
  i16(off: number): number;
  u32(off: number): number;
  tag(off: number): string;
}

export class Bin implements BinLike {
  private view: DataView;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  u16(off: number): number {
    return this.view.getUint16(off, false);
  }
  i16(off: number): number {
    return this.view.getInt16(off, false);
  }
  u32(off: number): number {
    return this.view.getUint32(off, false);
  }
  tag(off: number): string {
    let s = "";
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.view.getUint8(off + i));
    return s;
  }
  get byteLength(): number {
    return this.view.byteLength;
  }
}

/** Offset of the first font inside a TTF/OTF/TTC file, or -1. */
export function sfntOffset(bin: BinLike): number {
  if (bin.byteLength < 12) return -1;
  const tag = bin.tag(0);
  if (tag === "ttcf") {
    if (bin.byteLength < 16) return -1;
    return bin.u32(12);
  }
  if (tag === "\x00\x01\x00\x00" || tag === "OTTO" || tag === "true" || tag === "typ1") {
    return 0;
  }
  return -1;
}

/** Find a table's [offset, length] within the sfnt at base, or null. */
export function findTable(bin: BinLike, base: number, wanted: string): [number, number] | null {
  if (base < 0 || base + 12 > bin.byteLength) return null;
  const numTables = bin.u16(base + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > bin.byteLength) return null;
    if (bin.tag(rec) === wanted) {
      return [bin.u32(rec + 8), bin.u32(rec + 12)];
    }
  }
  return null;
}

class RangeBuilder {
  private ranges: Array<[number, number]> = [];
  addRange(start: number, end: number): void {
    if (end < start) return;
    const last = this.ranges[this.ranges.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      this.ranges.push([start, end]);
    }
  }
  addPoint(cp: number): void {
    this.addRange(cp, cp);
  }
  build(): Coverage {
    return this.ranges;
  }
}

function parseFormat12(bin: Bin, off: number, out: RangeBuilder): boolean {
  // header: format(2) reserved(2) length(4) language(4) nGroups(4)
  if (off + 16 > bin.byteLength) return false;
  const nGroups = bin.u32(off + 12);
  let pos = off + 16;
  for (let g = 0; g < nGroups; g++, pos += 12) {
    if (pos + 12 > bin.byteLength) return false;
    const start = bin.u32(pos);
    const end = bin.u32(pos + 4);
    const startGlyph = bin.u32(pos + 8);
    // glyph id for cp is startGlyph + (cp - start); only cp with id 0 drops out.
    const effectiveStart = startGlyph === 0 ? start + 1 : start;
    if (effectiveStart <= end) out.addRange(effectiveStart, end);
  }
  return true;
}

function parseFormat4(bin: Bin, off: number, out: RangeBuilder): boolean {
  if (off + 14 > bin.byteLength) return false;
  const segCount = bin.u16(off + 6) / 2;
  const endOff = off + 14;
  const startOff = endOff + 2 * segCount + 2;
  const deltaOff = startOff + 2 * segCount;
  const rangeOff = deltaOff + 2 * segCount;
  if (rangeOff + 2 * segCount > bin.byteLength) return false;
  for (let s = 0; s < segCount; s++) {
    const end = bin.u16(endOff + 2 * s);
    const start = bin.u16(startOff + 2 * s);
    const delta = bin.i16(deltaOff + 2 * s);
    const ro = bin.u16(rangeOff + 2 * s);
    if (start === 0xffff && end === 0xffff) continue;
    for (let cp = start; cp <= end; cp++) {
      let gid: number;
      if (ro === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const glyphIndexOff = rangeOff + 2 * s + ro + 2 * (cp - start);
        if (glyphIndexOff + 2 > bin.byteLength) continue;
        gid = bin.u16(glyphIndexOff);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) out.addPoint(cp);
    }
  }
  return true;
}

function parseFormat6(bin: Bin, off: number, out: RangeBuilder): boolean {
  if (off + 10 > bin.byteLength) return false;
  const first = bin.u16(off + 6);
  const count = bin.u16(off + 8);
  for (let i = 0; i < count; i++) {
    const pos = off + 10 + 2 * i;
    if (pos + 2 > bin.byteLength) return false;
    if (bin.u16(pos) !== 0) out.addPoint(first + i);
  }
  return true;
}

/**
 * Parse the cmap table of a TTF/OTF/TTC font into coverage ranges.
 * Returns null when no supported subtable exists (WOFF/WOFF2 included:
 * their cmap is compressed and out of scope for v1, per design §8-2).
 */
export function parseCmap(buf: ArrayBuffer): Coverage | null {
  try {
    const bin = new Bin(buf);
    const base = sfntOffset(bin);
    if (base < 0) return null;
    const table = findTable(bin, base, "cmap");
    if (!table) return null;
    const [cmapOff] = table;
    if (cmapOff + 4 > bin.byteLength) return null;
    const nTables = bin.u16(cmapOff + 2);
    type Sub = { platform: number; encoding: number; format: number; off: number };
    const subs: Sub[] = [];
    for (let i = 0; i < nTables; i++) {
      const rec = cmapOff + 4 + i * 8;
      if (rec + 8 > bin.byteLength) break;
      const subOff = cmapOff + bin.u32(rec + 4);
      if (subOff + 2 > bin.byteLength) continue;
      subs.push({
        platform: bin.u16(rec),
        encoding: bin.u16(rec + 2),
        format: bin.u16(subOff),
        off: subOff,
      });
    }
    const rank = (s: Sub): number => {
      // Prefer (3,10) fmt12, then (3,1) fmt4, then unicode platform, then rest.
      if (s.format === 12 && s.platform === 3 && s.encoding === 10) return 0;
      if (s.format === 4 && s.platform === 3 && s.encoding === 1) return 1;
      if (s.format === 12 && s.platform === 0) return 2;
      if (s.format === 12) return 3;
      if (s.format === 4 && s.platform === 0) return 4;
      if (s.format === 4) return 5;
      if (s.format === 6) return 6;
      return 9;
    };
    subs.sort((a, b) => rank(a) - rank(b));
    for (const sub of subs) {
      const out = new RangeBuilder();
      let ok = false;
      if (sub.format === 12) ok = parseFormat12(bin, sub.off, out);
      else if (sub.format === 4) ok = parseFormat4(bin, sub.off, out);
      else if (sub.format === 6) ok = parseFormat6(bin, sub.off, out);
      if (ok) {
        const cov = out.build();
        if (cov.length > 0) return cov;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Binary-search membership test. */
export function covers(cov: Coverage, cp: number): boolean {
  let lo = 0;
  let hi = cov.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = cov[mid];
    if (cp < s) hi = mid - 1;
    else if (cp > e) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Distinct characters of `text` that the coverage does not contain.
 * Control characters (CR, LF, TAB, ...) are never glyphs — line breaks in
 * particular must not be reported, whatever newline convention the text
 * was pasted with.
 */
export function missingChars(cov: Coverage, text: string): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (!covers(cov, cp) && !seen.has(ch)) {
      seen.add(ch);
      missing.push(ch);
    }
  }
  return missing;
}
