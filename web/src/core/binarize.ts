// Otsu binarization for thermal printing (design FR-15). Error diffusion
// is deliberately not used: it breaks thin strokes on thermal printers.

/** Otsu threshold for a luminance array; -1 when the image is uniform. */
export function otsuThreshold(lum: Uint8ClampedArray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  const total = lum.length;
  if (total === 0) return -1;
  let distinct = 0;
  for (let i = 0; i < 256; i++) if (hist[i] > 0) distinct++;
  if (distinct <= 1) return -1;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Return a binarized copy of the canvas (black ink on white paper). */
export function binarizeCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const sctx = src.getContext("2d");
  const octx = out.getContext("2d");
  if (!sctx || !octx) throw new Error("canvas-2d-unavailable");
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const data = img.data;
  const lum = new Uint8ClampedArray(src.width * src.height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  const t = otsuThreshold(lum);
  if (t >= 0) {
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      const v = lum[i] <= t ? 0 : 255;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
