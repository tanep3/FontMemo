// Imported-font storage (IndexedDB) and the import pipeline (design §2, §6).
// importFonts is the single entry point for files and ZIPs; addFont does
// per-font validation and persistence.

import { parseCmap, type Coverage } from "./cmap";
import { fontDisplayName, parseFaceInfo, sniffFormat, type FontFormat } from "./fontMeta";
import { extractFontCandidates, isZip, ZipLimitError } from "./unzip";

export interface StoredFont {
  id: string;
  name: string;
  format: FontFormat;
  blob: Blob;
  /** null when coverage is unavailable (WOFF/WOFF2, or unparseable cmap). */
  coverage: Coverage | null;
  hash: string;
  createdAt: number;
  /** Family-grouping fields (v0.2). Optional: records stored by v0.1.0
   *  lack them and are backfilled on first list. */
  family?: string;
  weight?: number;
  italic?: boolean;
}

/** A group of imported faces that belong to one family. */
export interface FontFamily {
  /** Anchor: the id of the family's earliest face record. */
  id: string;
  name: string;
  faces: FontMetaInfo[];
}

export type FontMetaInfo = Omit<StoredFont, "blob">;

export interface SkippedFont {
  name: string;
  reason: "not-font" | "duplicate" | "unreadable";
}

export interface ImportResult {
  added: FontMetaInfo[];
  skipped: SkippedFont[];
  /** Fatal, import-wide problem (no fonts found, ZIP limit, ...). */
  fatal?: string;
}

export class FontRejected extends Error {
  constructor(public reason: SkippedFont["reason"]) {
    super(reason);
    this.name = "FontRejected";
  }
}

// ---------- IndexedDB ----------

const DB_NAME = "fontmemo-db";
const STORE = "fonts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => {
          resolve(req.result);
          db.close();
        };
        req.onerror = () => {
          reject(req.error);
          db.close();
        };
      }),
  );
}

// ---------- hashing ----------

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- public API ----------

export async function addFont(blob: Blob, fallbackName?: string): Promise<FontMetaInfo> {
  const buf = await blob.arrayBuffer();
  const format = sniffFormat(buf);
  if (!format) throw new FontRejected("not-font");
  const hash = await sha256Hex(buf);
  const existing = await listFonts();
  if (existing.some((f) => f.hash === hash)) throw new FontRejected("duplicate");
  const name =
    fontDisplayName(buf) ??
    (fallbackName ? fallbackName.replace(/\.[^.]+$/, "") : null) ??
    "Font";
  const coverage = format === "woff" || format === "woff2" ? null : parseCmap(buf);
  const face = parseFaceInfo(buf);
  const record: StoredFont = {
    id: crypto.randomUUID(),
    name,
    format,
    blob,
    coverage,
    hash,
    createdAt: Date.now(),
    family: face?.family ?? name,
    weight: face?.weight ?? 400,
    italic: face?.italic ?? false,
  };
  await tx("readwrite", (store) => store.put(record));
  const { blob: _blob, ...meta } = record;
  return meta;
}

export async function importFonts(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  if (isZip(buf)) {
    let scan;
    try {
      scan = await extractFontCandidates(new Uint8Array(buf));
    } catch (e) {
      if (e instanceof ZipLimitError) return { added: [], skipped: [], fatal: e.reason };
      return { added: [], skipped: [], fatal: "zip-unreadable" };
    }
    if (scan.candidates.length === 0) {
      return { added: [], skipped: [], fatal: "no-fonts-in-zip" };
    }
    const added: FontMetaInfo[] = [];
    const skipped: SkippedFont[] = [];
    for (const cand of scan.candidates) {
      const base = cand.name.split("/").pop() ?? cand.name;
      try {
        const blob = new Blob([cand.data.buffer as ArrayBuffer]);
        added.push(await addFont(blob, base));
      } catch (e) {
        if (e instanceof FontRejected) skipped.push({ name: base, reason: e.reason });
        else skipped.push({ name: base, reason: "unreadable" });
      }
    }
    return { added, skipped };
  }
  try {
    const meta = await addFont(file, file.name);
    return { added: [meta], skipped: [] };
  } catch (e) {
    if (e instanceof FontRejected) {
      return { added: [], skipped: [{ name: file.name, reason: e.reason }] };
    }
    return { added: [], skipped: [{ name: file.name, reason: "unreadable" }] };
  }
}

export async function listFonts(): Promise<FontMetaInfo[]> {
  const all = await tx<StoredFont[]>("readonly", (store) => store.getAll() as IDBRequest<StoredFont[]>);
  // Backfill family fields for records stored before v0.2.
  for (const rec of all) {
    if (rec.family === undefined) {
      try {
        const buf = await rec.blob.arrayBuffer();
        const face = parseFaceInfo(buf);
        rec.family = face?.family ?? rec.name;
        rec.weight = face?.weight ?? 400;
        rec.italic = face?.italic ?? false;
        await tx("readwrite", (store) => store.put(rec));
      } catch {
        rec.family = rec.name;
        rec.weight = 400;
        rec.italic = false;
      }
    }
  }
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Imported fonts grouped into families (Regular/Bold/Italic together). */
export async function listFamilies(): Promise<FontFamily[]> {
  const fonts = await listFonts();
  const byFamily = new Map<string, FontMetaInfo[]>();
  for (const f of fonts) {
    const key = (f.family ?? f.name).trim().toLowerCase();
    const arr = byFamily.get(key) ?? [];
    arr.push(f);
    byFamily.set(key, arr);
  }
  const families: FontFamily[] = [];
  for (const faces of byFamily.values()) {
    faces.sort((a, b) => a.createdAt - b.createdAt);
    families.push({ id: faces[0].id, name: faces[0].family ?? faces[0].name, faces });
  }
  families.sort((a, b) => a.faces[0].createdAt - b.faces[0].createdAt);
  return families;
}

export async function getFont(id: string): Promise<StoredFont | undefined> {
  return tx<StoredFont | undefined>("readonly", (store) => store.get(id));
}

export async function deleteFont(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}
