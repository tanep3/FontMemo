// Platform canvas limits (design §5.4). Conservative initial values; the
// long side and the total area must both fit.

export interface CanvasCaps {
  maxLongSide: number;
  maxArea: number;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS reports as macOS but has touch.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function platformCaps(): CanvasCaps {
  return isIOS()
    ? { maxLongSide: 4096, maxArea: 4096 * 4096 }
    : { maxLongSide: 8192, maxArea: 8192 * 8192 };
}

export function withinCaps(width: number, height: number, caps: CanvasCaps): boolean {
  return Math.max(width, height) <= caps.maxLongSide && width * height <= caps.maxArea;
}
