// ZIP import (design §8-1). Limits are enforced in three stages:
//   1. Entry metadata (count, declared uncompressed size) before extraction.
//   2. Only font candidates (by extension) are extracted at all.
//   3. Actual output bytes are counted while streaming; overflow aborts.
// Real font-ness is verified later by sniffFormat in fontStore.addFont.

import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

export const ZIP_LIMITS = {
  maxEntries: 512,
  maxCandidates: 32,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 96 * 1024 * 1024,
} as const;

export class ZipLimitError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "ZipLimitError";
  }
}

export interface ZipCandidate {
  /** Entry name inside the ZIP (may include directories). */
  name: string;
  data: Uint8Array;
}

export interface ZipScan {
  candidates: ZipCandidate[];
  entryCount: number;
}

const FONT_EXT = /\.(ttf|otf|ttc|woff|woff2)$/i;

export function isZip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const b = new Uint8Array(buf, 0, 4);
  // PK\x03\x04 (normal), PK\x05\x06 (empty archive), PK\x07\x08 (spanned)
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
}

export function extractFontCandidates(data: Uint8Array): Promise<ZipScan> {
  return new Promise<ZipScan>((resolve, reject) => {
    const candidates: ZipCandidate[] = [];
    let entryCount = 0;
    let candidateCount = 0;
    let totalOut = 0;
    let pending = 0;
    let inputDone = false;
    let settled = false;

    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const maybeDone = () => {
      if (!settled && inputDone && pending === 0) {
        settled = true;
        resolve({ candidates, entryCount });
      }
    };

    const uz = new Unzip();
    uz.register(UnzipInflate);
    uz.register(UnzipPassThrough);
    uz.onfile = (file) => {
      entryCount++;
      if (entryCount > ZIP_LIMITS.maxEntries) {
        fail(new ZipLimitError("too-many-entries"));
        return;
      }
      const base = file.name.split("/").pop() ?? file.name;
      if (!FONT_EXT.test(base) || base.startsWith("._")) {
        return; // not a candidate: never started, never decompressed
      }
      candidateCount++;
      if (candidateCount > ZIP_LIMITS.maxCandidates) {
        fail(new ZipLimitError("too-many-candidates"));
        return;
      }
      // Stage 1: declared size check (0/undefined means "unknown").
      const declared = file.originalSize ?? 0;
      if (declared > ZIP_LIMITS.maxFileBytes) {
        fail(new ZipLimitError("file-too-large"));
        return;
      }
      if (declared > 0 && totalOut + declared > ZIP_LIMITS.maxTotalBytes) {
        fail(new ZipLimitError("total-too-large"));
        return;
      }
      const chunks: Uint8Array[] = [];
      let fileBytes = 0;
      pending++;
      file.ondata = (err, chunk, final) => {
        if (err) {
          fail(err);
          return;
        }
        if (settled) return;
        // Stage 3: count what actually comes out.
        fileBytes += chunk.length;
        totalOut += chunk.length;
        if (fileBytes > ZIP_LIMITS.maxFileBytes) {
          fail(new ZipLimitError("file-too-large"));
          return;
        }
        if (totalOut > ZIP_LIMITS.maxTotalBytes) {
          fail(new ZipLimitError("total-too-large"));
          return;
        }
        if (chunk.length > 0) chunks.push(chunk);
        if (final) {
          pending--;
          const merged = new Uint8Array(fileBytes);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          candidates.push({ name: file.name, data: merged });
          maybeDone();
        }
      };
      file.start();
    };
    try {
      uz.push(data, true);
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    inputDone = true;
    maybeDone();
  });
}
