// Settings persisted in localStorage (design FR-12). The text itself is
// never persisted (FR-01).

export type Lang = "ja" | "en";
export type Align = "left" | "center" | "right";
export type PrintMode = "normal" | "sideways";
export type WidthPreset = 250 | 384 | 576 | "custom";

export interface FontMemoSettings {
  /** "bundled:<id>", "family:<anchorId>" or "device:<id>". */
  fontId: string;
  fontSize: number;
  /** Font refs hidden from the style bar (font management On/Off). */
  disabledFonts: string[];
  /** Base (default) bold/italic, editable in the style bar (v0.2.1). */
  bold: boolean;
  italic: boolean;
  lineHeight: number;
  marginX: number;
  marginY: number;
  align: Align;
  widthPreset: WidthPreset;
  customWidth: number;
  mode: PrintMode;
  lang: Lang;
}

const KEY = "fontmemo-settings-v1";

export function bundledRef(id: string): string {
  return `bundled:${id}`;
}
export function importedRef(id: string): string {
  return `imported:${id}`;
}
export function familyRef(id: string): string {
  return `family:${id}`;
}
export function deviceRef(id: string): string {
  return `device:${id}`;
}

export type FontRefKind = "bundled" | "imported" | "family" | "device";

export function parseFontRef(ref: string): { kind: FontRefKind; id: string } {
  const idx = ref.indexOf(":");
  if (idx < 0) return { kind: "bundled", id: ref };
  const head = ref.slice(0, idx);
  const kind: FontRefKind =
    head === "imported" || head === "family" || head === "device" ? head : "bundled";
  return { kind, id: ref.slice(idx + 1) };
}

function detectLang(): Lang {
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function defaultSettings(): FontMemoSettings {
  return {
    fontId: bundledRef("rii-pop-kaku"),
    fontSize: 40,
    disabledFonts: [],
    bold: false,
    italic: false,
    lineHeight: 1.5,
    marginX: 16,
    marginY: 24,
    align: "left",
    widthPreset: 384,
    customWidth: 384,
    mode: "normal",
    lang: detectLang(),
  };
}

export function loadSettings(): FontMemoSettings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<FontMemoSettings>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: FontMemoSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full/blocked: settings just won't persist.
  }
}

export function paperWidthOf(s: FontMemoSettings): number {
  return s.widthPreset === "custom" ? s.customWidth : s.widthPreset;
}
