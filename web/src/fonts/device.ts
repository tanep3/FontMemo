// Device fonts (design §3 layer 2, selectable since v0.2 at the user's
// request): no files, no loading, no glyph coverage — just named stacks
// the OS resolves. "browser" is the device/browser standard font.

export interface DeviceFont {
  id: "browser" | "serif" | "sans";
  stack: string;
}

export const DEVICE_FONTS: DeviceFont[] = [
  {
    id: "browser",
    stack:
      'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif',
  },
  {
    id: "serif",
    stack:
      '"Hiragino Mincho ProN", "Hiragino Mincho", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif", serif',
  },
  {
    id: "sans",
    stack:
      '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif',
  },
];

export function deviceFont(id: string): DeviceFont {
  return DEVICE_FONTS.find((d) => d.id === id) ?? DEVICE_FONTS[0];
}
