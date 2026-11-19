// Font format sniffing (by content, never by extension), display-name
// extraction, and face information (family / weight / italic) used to
// group font files into families (design §2 + v0.2 family grouping).

import { Bin, findTable, sfntOffset } from "./cmap";

export type FontFormat = "ttf" | "otf" | "ttc" | "woff" | "woff2";

export function sniffFormat(buf: ArrayBuffer): FontFormat | null {
  if (buf.byteLength < 4) return null;
  const b = new Uint8Array(buf, 0, 4);
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "ttcf") return "ttc";
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "OTTO") return "otf";
  if (tag === "true" || tag === "typ1") return "ttf";
  if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return "ttf";
  return null;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return s;
}

function decodeMac(bytes: Uint8Array): string {
  // Approximation: the ASCII range is identical in MacRoman. Non-ASCII Mac
  // records are effectively extinct in current fonts (platform 3 wins).
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return s;
}

export interface NameRecord {
  platform: number;
  language: number;
  nameId: number;
  text: string;
}

/** All usable name records of the first face. */
export function readNameRecords(buf: ArrayBuffer): NameRecord[] {
  try {
    const bin = new Bin(buf);
    const base = sfntOffset(bin);
    if (base < 0) return [];
    const table = findTable(bin, base, "name");
    if (!table) return [];
    const [nameOff] = table;
    if (nameOff + 6 > bin.byteLength) return [];
    const count = bin.u16(nameOff + 2);
    const storage = nameOff + bin.u16(nameOff + 4);
    const records: NameRecord[] = [];
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      if (rec + 12 > bin.byteLength) break;
      const platform = bin.u16(rec);
      const language = bin.u16(rec + 4);
      const nameId = bin.u16(rec + 6);
      const length = bin.u16(rec + 8);
      const offset = storage + bin.u16(rec + 10);
      if (offset + length > bin.byteLength || length === 0) continue;
      const raw = new Uint8Array(buf, offset, length);
      const text = (platform === 1 ? decodeMac(raw) : decodeUtf16Be(raw))
        .replace(/\x00/g, "")
        .trim();
      if (text) records.push({ platform, language, nameId, text });
    }
    return records;
  } catch {
    return [];
  }
}

/** Best record for a name ID: Japanese platform-3 first, then any win/unicode. */
export function bestName(records: NameRecord[], nameId: number): string | null {
  const cands = records.filter((r) => r.nameId === nameId);
  if (cands.length === 0) return null;
  const score = (r: NameRecord): number => {
    if (r.platform === 3 && r.language === 0x411) return 0;
    if (r.platform === 3) return 1;
    if (r.platform === 0) return 2;
    return 3;
  };
  cands.sort((a, b) => score(a) - score(b));
  return cands[0].text;
}

/**
 * Display name from the name table: full name (ID 4) preferred over family
 * (ID 1). For TTC files only the first face is read (design §2).
 */
export function fontDisplayName(buf: ArrayBuffer): string | null {
  const records = readNameRecords(buf);
  return bestName(records, 4) ?? bestName(records, 1);
}

// ---------- face information (family grouping, bold/italic) ----------

export interface FontFaceInfo {
  /** Family name the file belongs to (style suffixes removed). */
  family: string;
  /** CSS-style weight: 100..900. */
  weight: number;
  italic: boolean;
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/bold/i, 700],
  [/black|heavy/i, 900],
];

function weightFromWords(text: string): number | null {
  for (const [re, w] of WEIGHT_WORDS) if (re.test(text)) return w;
  return null;
}

function tableU16(buf: ArrayBuffer, table: string, off: number): number | null {
  try {
    const bin = new Bin(buf);
    const base = sfntOffset(bin);
    if (base < 0) return null;
    const found = findTable(bin, base, table);
    if (!found) return null;
    const pos = found[0] + off;
    if (pos + 2 > bin.byteLength) return null;
    return bin.u16(pos);
  } catch {
    return null;
  }
}

/**
 * Determine which family a font file belongs to and which face it is.
 * Priority matters: many free fonts leave OS/2 weight at 400 even for
 * their bold file and only say "Bold" in the subfamily name (verified
 * with TekitouPoem Bold), so the subfamily wording wins over OS/2.
 */
export function parseFaceInfo(buf: ArrayBuffer): FontFaceInfo | null {
  const records = readNameRecords(buf);
  if (records.length === 0) return null;
  const family16 = bestName(records, 16);
  const family1 = bestName(records, 1);
  const subfamily = bestName(records, 17) ?? bestName(records, 2) ?? "";
  const display = bestName(records, 4) ?? family1 ?? "";

  let family = family16 ?? family1 ?? display;
  if (!family) return null;
  // When only ID 1 exists and it carries the subfamily as a suffix
  // ("Foo Bold"), split it off so Regular and Bold group together.
  if (!family16 && family1) {
    if (subfamily && subfamily !== "Regular" && family1.endsWith(` ${subfamily}`)) {
      family = family1.slice(0, family1.length - subfamily.length - 1);
    } else {
      for (const [re] of WEIGHT_WORDS) {
        const m = family1.match(new RegExp(`\\s+(${re.source})$`, "i"));
        if (m) {
          family = family1.slice(0, family1.length - m[0].length);
          break;
        }
      }
      if (/\s+(Italic|Oblique)$/i.test(family1)) {
        family = family1.replace(/\s+(Italic|Oblique)$/i, "");
      }
    }
  }

  const styleText = `${subfamily} ${!family16 && family1 ? family1.slice(family.length) : ""} ${display.slice(family.length)}`;
  const os2Weight = tableU16(buf, "OS/2", 4);
  const fsSelection = tableU16(buf, "OS/2", 62);
  const macStyle = tableU16(buf, "head", 44);

  let weight = weightFromWords(styleText);
  if (weight === null && fsSelection !== null && fsSelection & 0x20) weight = 700;
  if (weight === null && macStyle !== null && macStyle & 0x01) weight = 700;
  if (weight === null && os2Weight !== null && os2Weight !== 400) weight = os2Weight;
  if (weight === null) weight = 400;

  const italic =
    /italic|oblique/i.test(styleText) ||
    (fsSelection !== null && (fsSelection & 0x01) !== 0) ||
    (macStyle !== null && (macStyle & 0x02) !== 0);

  return { family: family.trim(), weight, italic };
}
