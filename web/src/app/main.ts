// FontMemo app wiring: WYSIWYG editor with per-range styles, font
// families with real bold/italic faces, device fonts. Since v0.5.0
// the editor IS the preview (it displays the print layout scaled to
// fit), and the PNG is generated on demand at save/share time.

import { covers, type Coverage } from "../fonts/cmap";
import {
  deleteFont,
  getFont,
  importFonts,
  listFamilies,
  type FontFamily,
  type FontMetaInfo,
  type ImportResult,
} from "../fonts/fontStore";
import {
  cssFont,
  ensureFace,
  fontStack,
  hasBoldFace,
  hasItalicFace,
  internalFamily,
  pickFace,
  type FaceSpec,
} from "../fonts/loader";
import {
  BUNDLED_FONTS,
  bundledCoverage,
  bundledFaceUrl,
  bundledLicenseUrl,
  type BundledFont,
} from "../fonts/bundled";
import { DEVICE_FONTS, deviceFont } from "../fonts/device";
import {
  cpLength,
  styleAtCp,
  type RunStyle,
  type TextSegment,
} from "../core/runs";
import { layoutText, type SegmentInput } from "../core/layout";
import { PAPER_GUIDES_YOKO, guideLengthPx } from "../core/guides";
import { renderCanvas, rotate90CW } from "../core/render";
import { binarizeCanvas } from "../core/binarize";
import { platformCaps } from "../core/caps";
import { nextSaveName } from "../core/saveName";
import { canSharePng, savePng, sharePng } from "../core/share";
import {
  bundledRef,
  deviceRef,
  familyRef,
  loadSettings,
  paperWidthOf,
  parseFontRef,
  saveSettings,
  type FontMemoSettings,
  type Lang,
} from "./settings";
import { Editor } from "./editor";
import { strings, type Strings } from "./i18n";
import { initPwa } from "./pwa";
import "./style.css";

declare const __APP_VERSION__: string;

type Settings = FontMemoSettings;

const APP_VERSION = __APP_VERSION__;
/**
 * Editor magnification: the editor displays the print layout scaled
 * so the paper width fits the editor's width (zoom = editor width /
 * paper width), recomputed on resize and paper changes. Display
 * only, deliberately not a setting.
 */
let viewZoom = 1;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

let settings: Settings = loadSettings();
let S: Strings = strings(settings.lang);

const editorRoot = $<HTMLDivElement>("editor");
const editor = new Editor(editorRoot);
const guideOverlay = $<HTMLDivElement>("guideOverlay");
const guideNote = $<HTMLParagraphElement>("guideNote");

// Sideways paper-size guides (display only): one dashed line per
// A/B landscape size, positioned from the print start edge. The
// overlay sits over the editor and the lines are repositioned on
// scroll, because the editor scrolls its content underneath it.
const guideLineEls: HTMLDivElement[] = PAPER_GUIDES_YOKO.map((g) => {
  const line = document.createElement("div");
  line.className = `guide-line series-${g.series === "A" ? "a" : "b"}`;
  const label = document.createElement("span");
  label.className = "guide-label";
  label.textContent = g.label;
  line.appendChild(label);
  guideOverlay.appendChild(line);
  return line;
});

function refreshGuides(): void {
  const sideways = settings.mode === "sideways";
  guideOverlay.hidden = !sideways;
  guideNote.hidden = !sideways;
  if (!sideways) return;
  const paperWidth = paperWidthOf(settings);
  PAPER_GUIDES_YOKO.forEach((g, i) => {
    const x = guideLengthPx(g.longSideMm, paperWidth) * viewZoom - editorRoot.scrollLeft;
    guideLineEls[i].style.left = `${Math.round(x)}px`;
  });
}

editorRoot.addEventListener("scroll", refreshGuides);
const styleFontSelect = $<HTMLSelectElement>("styleFontSelect");
const styleScaleRange = $<HTMLInputElement>("styleScaleRange");
const styleScaleOut = $<HTMLOutputElement>("styleScaleOut");
const alignSeg = $("alignSeg");
const boldButton = $<HTMLButtonElement>("boldButton");
const italicButton = $<HTMLButtonElement>("italicButton");
const clearStyleButton = $<HTMLButtonElement>("clearStyleButton");
const warningBox = $<HTMLDivElement>("warningBox");
const warningText = $<HTMLParagraphElement>("warningText");
const missingText = $<HTMLParagraphElement>("missingText");
const fontList = $<HTMLDivElement>("fontList");
const specimen = $<HTMLDivElement>("specimen");
const specimenName = $<HTMLSpanElement>("specimenName");
const specimenSample = $<HTMLDivElement>("specimenSample");
const specimenMeta = $<HTMLSpanElement>("specimenMeta");
const useFontButton = $<HTMLButtonElement>("useFontButton");
const deleteFontButton = $<HTMLButtonElement>("deleteFontButton");
const importButton = $<HTMLButtonElement>("importButton");
const importMessage = $<HTMLParagraphElement>("importMessage");
const fontFileInput = $<HTMLInputElement>("fontFileInput");
const saveButton = $<HTMLButtonElement>("saveButton");
const shareButton = $<HTMLButtonElement>("shareButton");
const generatingLabel = $<HTMLSpanElement>("generatingLabel");
const langButton = $<HTMLButtonElement>("langButton");
const versionLabel = $<HTMLSpanElement>("versionLabel");
const creditsButton = $<HTMLButtonElement>("creditsButton");
const creditsDialog = $<HTMLDialogElement>("creditsDialog");
const creditsList = $<HTMLUListElement>("creditsList");
const creditsClose = $<HTMLButtonElement>("creditsClose");

let families: FontFamily[] = [];
/** True when the current text lays out within the caps (save/share on). */
let docValid = false;
let busy = false;
let generation = 0;
let debounceTimer: number | undefined;
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

// ---------- font choices ----------

interface ChoiceFace extends FaceSpec {
  coverage: Coverage | null;
  load: () => Promise<void>;
}

interface Choice {
  ref: string;
  name: string;
  faces: ChoiceFace[];
  deviceStack: string | null;
}

function bundledChoice(font: BundledFont): Choice {
  const ref = bundledRef(font.id);
  return {
    ref,
    name: font.name,
    deviceStack: null,
    faces: font.faces.map((face) => ({
      weight: face.weight,
      italic: face.italic,
      coverage: bundledCoverage(face.coverageId),
      load: () => ensureFace(ref, face, bundledFaceUrl(face)).then(() => undefined),
    })),
  };
}

function familyChoice(family: FontFamily): Choice {
  const ref = familyRef(family.id);
  return {
    ref,
    name: family.name,
    deviceStack: null,
    faces: family.faces.map((meta) => ({
      weight: meta.weight ?? 400,
      italic: meta.italic ?? false,
      coverage: meta.coverage,
      load: async () => {
        const stored = await getFont(meta.id);
        if (!stored) return;
        await ensureFace(
          ref,
          { weight: meta.weight ?? 400, italic: meta.italic ?? false },
          await stored.blob.arrayBuffer(),
        );
      },
    })),
  };
}

function deviceChoice(id: string): Choice {
  const dev = deviceFont(id);
  return {
    ref: deviceRef(dev.id),
    name: dev.id === "browser" ? S.deviceBrowser : dev.id === "serif" ? S.deviceSerif : S.deviceSans,
    deviceStack: dev.stack,
    faces: [{ weight: 400, italic: false, coverage: null, load: () => Promise.resolve() }],
  };
}

function allChoices(): Choice[] {
  return [
    ...BUNDLED_FONTS.map(bundledChoice),
    ...families.map(familyChoice),
    ...DEVICE_FONTS.map((d) => deviceChoice(d.id)),
  ];
}

function resolveChoice(ref: string): Choice | null {
  if (!ref) return null;
  const parsed = parseFontRef(ref);
  if (parsed.kind === "bundled") {
    const font = BUNDLED_FONTS.find((f) => f.id === parsed.id);
    return font ? bundledChoice(font) : null;
  }
  if (parsed.kind === "device") return deviceChoice(parsed.id);
  if (parsed.kind === "family") {
    const family = families.find((f) => f.id === parsed.id);
    return family ? familyChoice(family) : null;
  }
  // Legacy v0.1.0 ref to a single imported file: use its family.
  const family = families.find((f) => f.faces.some((face) => face.id === parsed.id));
  return family ? familyChoice(family) : null;
}

function baseChoice(): Choice {
  const choice = resolveChoice(settings.fontId);
  if (choice) return choice;
  const fallback = bundledChoice(BUNDLED_FONTS[0]);
  settings.fontId = fallback.ref;
  return fallback;
}

/** CSS stack for a choice (device fonts use their own stack). */
function stackFor(choice: Choice): string {
  return choice.deviceStack ?? fontStack(internalFamily(choice.ref));
}

/** The face a (bold, italic) request resolves to, with its CSS spec. */
function resolveFace(
  choice: Choice,
  bold: boolean,
  italic: boolean,
): { face: ChoiceFace; spec: FaceSpec } {
  if (choice.deviceStack) {
    return { face: choice.faces[0], spec: { weight: bold ? 700 : 400, italic } };
  }
  const face = pickFace(choice.faces, bold, italic);
  return { face, spec: { weight: face.weight, italic: face.italic } };
}

function choiceHasBold(choice: Choice): boolean {
  return choice.deviceStack !== null || hasBoldFace(choice.faces);
}
function choiceHasItalic(choice: Choice): boolean {
  return choice.deviceStack !== null || hasItalicFace(choice.faces);
}

// ---------- editor decoration ----------

function updateEditorBase(): void {
  // The magnification follows the editor's width and the paper width.
  const w = editorRoot.clientWidth;
  if (w > 0) viewZoom = w / paperWidthOf(settings);
  const choice = baseChoice();
  const { face, spec } = resolveFace(choice, settings.bold, settings.italic);
  editorRoot.style.fontFamily = stackFor(choice);
  // Editor display size = print font size × view magnification.
  editorRoot.style.fontSize = `${Math.max(6, Math.round(settings.fontSize * viewZoom))}px`;
  editorRoot.style.fontWeight = String(spec.weight);
  editorRoot.style.fontStyle = spec.italic ? "italic" : "normal";
  editorRoot.style.lineHeight = String(settings.lineHeight);
  // Page geometry: the padding is the print margins × zoom, so the
  // content box is exactly the print content width × zoom and lines
  // wrap where the print layout wraps them.
  editorRoot.style.padding = `${Math.round(settings.marginY * viewZoom)}px ${Math.round(settings.marginX * viewZoom)}px`;
  if (settings.mode === "sideways") {
    // No wrapping; the box is exactly the paper width tall (that is
    // the print width after rotation). Long lines scroll sideways.
    editorRoot.style.whiteSpace = "pre";
    editorRoot.style.height = `${Math.round(paperWidthOf(settings) * viewZoom)}px`;
    editorRoot.style.minHeight = "0";
    editorRoot.style.overflow = "auto";
  } else {
    editorRoot.style.whiteSpace = "";
    editorRoot.style.height = "";
    editorRoot.style.minHeight = "";
    editorRoot.style.overflow = "";
  }
  refreshGuides();
  void face.load().then(() => editor.redecorate());
}

/** Whether a span's text contains a glyph its face does not cover. */
function spanHasMissing(text: string, style: RunStyle): boolean {
  const choice = (style.fontRef ? resolveChoice(style.fontRef) : null) ?? baseChoice();
  const { face } = resolveFace(choice, style.bold ?? settings.bold, style.italic ?? settings.italic);
  if (!face.coverage) return false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0x20 && !(cp >= 0x7f && cp <= 0x9f) && !covers(face.coverage, cp)) return true;
  }
  return false;
}

/** Gate for missing-glyph decoration; null while nothing is missing. */
let missingActive = false;

editor.decorate = (span, style) => {
  const effChoice = style.fontRef ? (resolveChoice(style.fontRef) ?? baseChoice()) : baseChoice();
  const { face, spec } = resolveFace(effChoice, style.bold ?? false, style.italic ?? false);
  span.style.fontFamily = stackFor(effChoice);
  // Editor display = the range's print size × the view magnification,
  // so size differences stay visible proportionally while writing.
  span.style.fontSize = style.size
    ? `${Math.max(6, Math.round(style.size * viewZoom))}px`
    : "";
  span.style.fontWeight = String(spec.weight);
  span.style.fontStyle = spec.italic ? "italic" : "normal";
  // Missing glyphs are marked in the editor itself (the print PNG
  // never carries marks; it draws the fallback face instead).
  const missing = missingActive && spanHasMissing(span.textContent ?? "", style);
  span.style.textDecorationLine = missing ? "underline" : "";
  span.style.textDecorationStyle = missing ? "wavy" : "";
  span.style.textDecorationColor = missing ? "#d84040" : "";
  void face.load();
};

// ---------- validation / generation pipeline ----------

interface ResolvedSeg {
  input: SegmentInput;
  coverage: Coverage | null;
  cpStart: number;
}

async function resolveSegments(segments: TextSegment[]): Promise<ResolvedSeg[]> {
  const out: ResolvedSeg[] = [];
  let cp = 0;
  const base = baseChoice();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const choice = (seg.style.fontRef ? resolveChoice(seg.style.fontRef) : null) ?? base;
    const { face, spec } = resolveFace(
      choice,
      seg.style.bold ?? settings.bold,
      seg.style.italic ?? settings.italic,
    );
    await face.load();
    const sizePx = Math.max(6, Math.min(400, Math.round(seg.style.size ?? settings.fontSize)));
    const font = cssFont(spec, sizePx, stackFor(choice));
    const measure = (t: string): number => {
      if (!measureCtx) return t.length * sizePx;
      measureCtx.font = font;
      return measureCtx.measureText(t).width;
    };
    out.push({
      input: { text: seg.text, sizePx, cssFont: font, measure, segId: i },
      coverage: face.coverage,
      cpStart: cp,
    });
    cp += cpLength(seg.text);
  }
  return out;
}

function setGenerating(on: boolean): void {
  busy = on;
  generatingLabel.hidden = !on;
  generatingLabel.textContent = on ? S.generating : "";
  saveButton.disabled = on || !docValid;
  shareButton.disabled = on || !docValid;
}

function layoutOptions() {
  return {
    lineHeightFactor: settings.lineHeight,
    marginX: settings.marginX,
    marginY: settings.marginY,
    align: settings.align,
    paragraphAligns: editor.readAligns(),
    mode: settings.mode,
    paperWidth: paperWidthOf(settings),
    caps: platformCaps(),
    baseSizePx: settings.fontSize,
  };
}

/**
 * Validate the current text: layout within the caps, and which glyphs
 * the chosen faces miss. The editor shows the layout itself, so this
 * only drives warnings, in-editor missing marks, and whether the
 * save/share buttons are live. The PNG is generated on demand.
 */
async function validate(): Promise<void> {
  const gen = ++generation;
  const segments = editor.readSegments();
  const text = segments.map((s) => s.text).join("");
  editorRoot.classList.toggle("is-empty", text.trim() === "");
  if (text.trim() === "") {
    docValid = false;
    missingActive = false;
    warningBox.hidden = true;
    setGenerating(false);
    return;
  }
  try {
    const resolved = await resolveSegments(segments);
    if (gen !== generation) return;
    const layout = layoutText(resolved.map((r) => r.input), layoutOptions());
    if (gen !== generation) return;
    if (!layout.ok) {
      docValid = false;
      warningText.textContent = layout.reason === "block-too-tall" ? S.warnBlockTall : S.warnTooLong;
      warningBox.hidden = false;
      missingText.hidden = true;
      setGenerating(false);
      return;
    }

    // Missing glyphs, judged per segment face.
    const missingCharsList: string[] = [];
    for (const r of resolved) {
      if (!r.coverage) continue;
      for (const ch of r.input.text) {
        const cp = ch.codePointAt(0) as number;
        if (cp >= 0x20 && !(cp >= 0x7f && cp <= 0x9f) && !covers(r.coverage, cp)) {
          if (!missingCharsList.includes(ch)) missingCharsList.push(ch);
        }
      }
    }

    docValid = true;
    if (missingCharsList.length > 0) {
      warningText.textContent = S.warnMissing(missingCharsList.join(" "));
      missingText.hidden = true;
      warningBox.hidden = false;
    } else {
      warningBox.hidden = true;
    }
    refreshMissingMarks(missingCharsList.length > 0);
    setGenerating(false);
  } catch {
    if (gen !== generation) return;
    docValid = false;
    warningText.textContent = S.warnGenFailed;
    warningBox.hidden = false;
    missingText.hidden = true;
    setGenerating(false);
  }
}

/**
 * Apply missing-glyph marks inside the editor. Marks live on spans;
 * text typed or pasted outside spans is canonicalized once (the same
 * rewrite the style operations use), never during IME composition.
 */
function refreshMissingMarks(hasMissing: boolean): void {
  missingActive = hasMissing;
  if (hasMissing && !editor.isComposing && editor.hasBareText()) {
    const range = editor.selectionRange();
    applyingStyle = true;
    editor.rewrite(editor.readSegments(), editor.readAligns());
    applyingStyle = false;
    if (range) editor.setSelection(range.start, range.end);
  }
  editor.redecorate();
}

/** Render the print PNG at full resolution (save/share time). */
async function generatePngBlob(): Promise<Blob | null> {
  const segments = editor.readSegments();
  const resolved = await resolveSegments(segments);
  const layout = layoutText(resolved.map((r) => r.input), layoutOptions());
  if (!layout.ok) return null;
  let canvas = renderCanvas(layout);
  if (settings.mode === "sideways") canvas = rotate90CW(canvas);
  const finalCanvas = binarizeCanvas(canvas);
  return new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, "image/png"));
}

function scheduleValidate(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void validate(), 250);
}

// ---------- style bar ----------
// Always active: with a selection it edits that range; without one it
// edits the defaults (base font, base size, base bold/italic). The last
// selection is remembered because on mobile the live DOM selection
// collapses as soon as a control outside the editor is tapped — the
// native selection UI itself (handles, copy/paste) is untouched.

let savedRange: { start: number; end: number } | null = null;
let applyingStyle = false;

function effectiveRange(): { start: number; end: number } | null {
  const live = editor.selectionRange();
  if (live && live.end > live.start) {
    savedRange = live;
    return live;
  }
  return savedRange;
}

function applyPatchToRange(patch: Record<string, string | number | boolean | null>): void {
  const range = effectiveRange();
  if (!range) return;
  applyingStyle = true;
  editor.applyToRange(range.start, range.end, patch);
  applyingStyle = false;
  refreshStyleBar();
}

function renderStyleFontOptions(): void {
  styleFontSelect.innerHTML = "";
  for (const choice of allChoices()) {
    // Off fonts leave the style bar; the font in use always stays.
    if (!isEnabled(choice.ref) && choice.ref !== settings.fontId) continue;
    const opt = document.createElement("option");
    opt.value = choice.ref;
    opt.textContent = choice.name;
    styleFontSelect.appendChild(opt);
  }
}

function paintToggle(button: HTMLButtonElement, on: boolean): void {
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", String(on));
}

// Alignment is a paragraph property: the seg shows and sets the
// alignment of the paragraph at the caret (or of every paragraph a
// selection touches). With no caret it edits the default alignment.
const alignButtons = Array.from(alignSeg.querySelectorAll<HTMLButtonElement>("button[data-value]"));

function caretOrRange(): { start: number; end: number } | null {
  return editor.selectionRange() ?? savedRange;
}

function paintAlignSeg(): void {
  const range = caretOrRange();
  const current = (range ? editor.alignAt(range.start) : undefined) ?? settings.align;
  for (const b of alignButtons) b.classList.toggle("on", b.dataset.value === current);
}

function refreshStyleBar(): void {
  const range = effectiveRange();
  if (range) {
    const segments = editor.readSegments();
    const style: RunStyle = styleAtCp(segments, range.start) ?? {};
    const penRef = style.fontRef ?? settings.fontId;
    styleFontSelect.value = resolveChoice(penRef) ? penRef : settings.fontId;
    const size = style.size ?? settings.fontSize;
    styleScaleRange.min = "12";
    styleScaleRange.max = "160";
    styleScaleRange.step = "1";
    styleScaleRange.value = String(size);
    styleScaleOut.textContent = `${size}px`;
    paintToggle(boldButton, style.bold ?? settings.bold);
    paintToggle(italicButton, style.italic ?? settings.italic);
  } else {
    // No selection: the bar edits the defaults. The size slider is the
    // base font size itself (moved here from the settings card).
    styleFontSelect.value = settings.fontId;
    styleScaleRange.min = "16";
    styleScaleRange.max = "96";
    styleScaleRange.step = "1";
    styleScaleRange.value = String(settings.fontSize);
    styleScaleOut.textContent = `${settings.fontSize}px`;
    paintToggle(boldButton, settings.bold);
    paintToggle(italicButton, settings.italic);
  }
  paintAlignSeg();
}

styleFontSelect.addEventListener("change", () => {
  const ref = styleFontSelect.value;
  const range = effectiveRange();
  if (!range) {
    void selectChoice(ref);
    return;
  }
  const patch: Record<string, string | boolean | null> = {
    fontRef: ref === settings.fontId ? null : ref,
  };
  const choice = resolveChoice(ref);
  const segments = editor.readSegments();
  const style = styleAtCp(segments, range.start) ?? {};
  if (choice && (style.bold ?? settings.bold) && !choiceHasBold(choice)) patch.bold = null;
  if (choice && (style.italic ?? settings.italic) && !choiceHasItalic(choice)) patch.italic = null;
  applyPatchToRange(patch);
});

styleScaleRange.addEventListener("input", () => {
  styleScaleOut.textContent = `${styleScaleRange.value}px`;
});
styleScaleRange.addEventListener("change", () => {
  const value = Number(styleScaleRange.value);
  if (effectiveRange()) {
    applyPatchToRange({ size: value === settings.fontSize ? null : value });
  } else {
    settings.fontSize = Math.max(16, Math.min(96, Math.round(value)));
    saveSettings(settings);
    updateEditorBase();
    void validate();
  }
  refreshStyleBar();
});

function toggleBaseOrRange(kind: "bold" | "italic"): void {
  const range = effectiveRange();
  if (range) {
    const segments = editor.readSegments();
    const style = styleAtCp(segments, range.start) ?? {};
    const current = style[kind] ?? settings[kind];
    applyPatchToRange({ [kind]: !current });
  } else {
    settings[kind] = !settings[kind];
    saveSettings(settings);
    updateEditorBase();
    void validate();
    refreshStyleBar();
  }
}

boldButton.addEventListener("click", () => toggleBaseOrRange("bold"));
italicButton.addEventListener("click", () => toggleBaseOrRange("italic"));
clearStyleButton.addEventListener("click", () => {
  if (effectiveRange()) {
    applyPatchToRange({ fontRef: null, size: null, bold: null, italic: null });
  } else {
    settings.bold = false;
    settings.italic = false;
    settings.fontSize = 40;
    saveSettings(settings);
    updateEditorBase();
    void validate();
    refreshStyleBar();
  }
});

for (const b of alignButtons) {
  b.addEventListener("click", () => {
    const value = b.dataset.value as Settings["align"];
    const range = caretOrRange();
    if (range) {
      applyingStyle = true;
      editor.applyAlignToRange(range.start, range.end, value);
      applyingStyle = false;
    } else {
      settings.align = value;
      saveSettings(settings);
      void validate();
    }
    paintAlignSeg();
  });
}

// Buttons must not steal the editor's focus/selection when tapped.
for (const button of [boldButton, italicButton, clearStyleButton, ...alignButtons]) {
  button.addEventListener("pointerdown", (e) => e.preventDefault());
}

let selChangeTimer: number | undefined;
document.addEventListener("selectionchange", () => {
  window.clearTimeout(selChangeTimer);
  selChangeTimer = window.setTimeout(() => {
    const live = editor.selectionRange();
    if (live && live.end > live.start) savedRange = live;
    else if (live && document.activeElement === editorRoot) savedRange = null;
    refreshStyleBar();
  }, 120);
});

editor.onChange(() => {
  if (!applyingStyle) savedRange = null;
  scheduleValidate();
  refreshStyleBar();
});

// ---------- font management: list, specimen, on/off ----------

let specimenRef: string | null = null;

function isEnabled(ref: string): boolean {
  return !settings.disabledFonts.includes(ref);
}

function renderFontList(): void {
  fontList.innerHTML = "";
  const entries: { choice: Choice; sub: string }[] = [
    ...BUNDLED_FONTS.map((f) => ({ choice: bundledChoice(f), sub: f.author })),
    ...families.map((f) => ({
      choice: familyChoice(f),
      sub: f.faces.map((face) => face.name).join(" / "),
    })),
    ...DEVICE_FONTS.map((d) => ({ choice: deviceChoice(d.id), sub: S.deviceBadge })),
  ];
  for (const { choice, sub } of entries) {
    const row = document.createElement("div");
    row.className = "font-row" + (specimenRef === choice.ref ? " on" : "");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "font-row-main";
    const name = document.createElement("span");
    name.className = "font-row-name";
    name.textContent = choice.name;
    const subEl = document.createElement("span");
    subEl.className = "font-row-sub";
    subEl.textContent = sub;
    main.append(name, subEl);
    main.addEventListener("click", () => showSpecimen(choice.ref));
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isEnabled(choice.ref);
    input.addEventListener("change", () => {
      if (input.checked) {
        settings.disabledFonts = settings.disabledFonts.filter((r) => r !== choice.ref);
      } else if (!settings.disabledFonts.includes(choice.ref)) {
        settings.disabledFonts = [...settings.disabledFonts, choice.ref];
      }
      saveSettings(settings);
      renderStyleFontOptions();
      refreshStyleBar();
      renderFontList();
    });
    const track = document.createElement("span");
    track.className = "track";
    label.append(input, track);
    row.append(main, label);
    fontList.appendChild(row);
  }
}

function showSpecimen(ref: string): void {
  const choice = resolveChoice(ref);
  if (!choice) return;
  specimenRef = ref;
  const parsed = parseFontRef(ref);
  specimen.hidden = false;
  specimenName.textContent = choice.name;
  specimenSample.textContent = S.specimenSample;
  specimenSample.style.fontFamily = stackFor(choice);
  const { face } = resolveFace(choice, false, false);
  void face.load();
  if (parsed.kind === "bundled") {
    const font = BUNDLED_FONTS.find((f) => f.id === parsed.id) as BundledFont;
    specimenMeta.textContent = `${font.author} · ${font.licenseLabel}`;
    deleteFontButton.hidden = true;
  } else if (parsed.kind === "device") {
    specimenMeta.textContent = S.deviceBadge;
    deleteFontButton.hidden = true;
  } else {
    const family = families.find(
      (f) => f.id === parsed.id || f.faces.some((fc) => fc.id === parsed.id),
    );
    specimenMeta.textContent = family ? family.faces.map((f) => f.name).join(" / ") : "";
    deleteFontButton.hidden = false;
    deleteFontButton.textContent = S.deleteFont;
  }
  renderFontList();
}

useFontButton.addEventListener("click", async () => {
  if (!specimenRef) return;
  settings.disabledFonts = settings.disabledFonts.filter((r) => r !== specimenRef);
  saveSettings(settings);
  await selectChoice(specimenRef);
  renderFontList();
});

async function selectChoice(ref: string): Promise<void> {
  settings.fontId = ref;
  saveSettings(settings);
  updateEditorBase();
  editor.redecorate();
  renderFontList();
  renderStyleFontOptions();
  refreshStyleBar();
  await validate();
}

deleteFontButton.addEventListener("click", async () => {
  if (!specimenRef) return;
  const parsed = parseFontRef(specimenRef);
  const family = families.find(
    (f) => f.id === parsed.id || f.faces.some((face) => face.id === parsed.id),
  );
  if (!family) return;
  if (!window.confirm(S.confirmDelete(family.name))) return;
  for (const face of family.faces) await deleteFont(face.id);
  families = await listFamilies();
  settings.disabledFonts = settings.disabledFonts.filter((r) => r !== specimenRef);
  if (settings.fontId === familyRef(family.id)) {
    settings.fontId = bundledRef(BUNDLED_FONTS[0].id);
  }
  specimenRef = null;
  specimen.hidden = true;
  saveSettings(settings);
  updateEditorBase();
  editor.redecorate();
  renderFontList();
  renderStyleFontOptions();
  refreshStyleBar();
  await validate();
});

// ---------- import ----------

function showImportMessage(text: string): void {
  importMessage.textContent = text;
  importMessage.hidden = text === "";
}

function fatalMessage(code: string): string {
  switch (code) {
    case "too-many-entries":
      return S.fatalTooManyEntries;
    case "too-many-candidates":
      return S.fatalTooManyCandidates;
    case "file-too-large":
      return S.fatalFileTooLarge;
    case "total-too-large":
      return S.fatalTotalTooLarge;
    case "no-fonts-in-zip":
      return S.fatalNoFonts;
    default:
      return S.fatalZipUnreadable;
  }
}

function reasonMessage(reason: string): string {
  if (reason === "duplicate") return S.reasonDuplicate;
  if (reason === "not-font") return S.reasonNotFont;
  return S.reasonUnreadable;
}

async function handleImport(file: File): Promise<void> {
  showImportMessage(S.loadingFont);
  const result: ImportResult = await importFonts(file);
  families = await listFamilies();
  renderFontList();
  renderStyleFontOptions();
  if (result.fatal) {
    showImportMessage(fatalMessage(result.fatal));
    return;
  }
  const messages: string[] = [];
  if (result.added.length > 0) {
    messages.push(S.importAdded(result.added.map((f) => f.name).join("、")));
  }
  if (result.skipped.length > 0) {
    messages.push(
      S.importSkipped(
        result.skipped.map((s) => `${s.name}（${reasonMessage(s.reason)}）`).join("、"),
      ),
    );
  }
  showImportMessage(messages.join(" "));
  if (result.added.length > 0) {
    const first = result.added[0];
    const family = families.find((f) => f.faces.some((face) => face.id === first.id));
    if (family) await selectChoice(familyRef(family.id));
  }
}

importButton.addEventListener("click", () => fontFileInput.click());
fontFileInput.addEventListener("change", () => {
  const file = fontFileInput.files?.[0];
  fontFileInput.value = "";
  if (file) void handleImport(file);
});

const fontCard = $<HTMLElement>("fontCard");
fontCard.addEventListener("dragover", (e) => e.preventDefault());
fontCard.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleImport(file);
});

// ---------- settings controls ----------

function bindRange(
  id: string,
  outId: string,
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string,
): void {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(outId);
  input.value = String(get());
  out.textContent = format(get());
  input.addEventListener("input", () => {
    const v = Number(input.value);
    set(v);
    out.textContent = format(v);
    saveSettings(settings);
    updateEditorBase();
    scheduleValidate();
  });
}

function bindSeg(id: string, get: () => string, set: (v: string) => void): void {
  const seg = $(id);
  const buttons = Array.from(seg.querySelectorAll<HTMLButtonElement>("button[data-value]"));
  const paint = () => {
    for (const b of buttons) b.classList.toggle("on", b.dataset.value === get());
  };
  for (const b of buttons) {
    b.addEventListener("click", () => {
      set(b.dataset.value as string);
      saveSettings(settings);
      paint();
      updateEditorBase();
      void validate();
    });
  }
  paint();
}

function initSettingsControls(): void {
  bindRange("lineHeightRange", "lineHeightOut", () => settings.lineHeight, (v) => (settings.lineHeight = v), (v) => v.toFixed(2));
  bindRange("marginXRange", "marginXOut", () => settings.marginX, (v) => (settings.marginX = v), (v) => `${v}px`);
  bindRange("marginYRange", "marginYOut", () => settings.marginY, (v) => (settings.marginY = v), (v) => `${v}px`);

  bindSeg("modeSeg", () => settings.mode, (v) => (settings.mode = v as Settings["mode"]));

  const widthSeg = $("widthSeg");
  const customInput = $<HTMLInputElement>("customWidthInput");
  const paintWidth = () => {
    const current = settings.widthPreset === "custom" ? "custom" : String(settings.widthPreset);
    for (const b of Array.from(widthSeg.querySelectorAll<HTMLButtonElement>("button[data-value]"))) {
      b.classList.toggle("on", b.dataset.value === current);
    }
    customInput.hidden = settings.widthPreset !== "custom";
    customInput.value = String(settings.customWidth);
  };
  for (const b of Array.from(widthSeg.querySelectorAll<HTMLButtonElement>("button[data-value]"))) {
    b.addEventListener("click", () => {
      if (b.dataset.value === "custom") settings.widthPreset = "custom";
      else settings.widthPreset = Number(b.dataset.value) as Settings["widthPreset"];
      saveSettings(settings);
      paintWidth();
      updateEditorBase();
      void validate();
    });
  }
  customInput.addEventListener("input", () => {
    const v = Math.max(100, Math.min(2000, Number(customInput.value) || 384));
    settings.customWidth = v;
    saveSettings(settings);
    updateEditorBase();
    scheduleValidate();
  });
  paintWidth();
}

// ---------- save / share ----------

saveButton.addEventListener("click", async () => {
  if (!docValid || busy) return;
  setGenerating(true);
  try {
    const blob = await generatePngBlob();
    if (blob) savePng(blob, nextSaveName());
  } catch {
    warningText.textContent = S.warnGenFailed;
    warningBox.hidden = false;
  }
  setGenerating(false);
});
shareButton.addEventListener("click", async () => {
  if (!docValid || busy) return;
  const name = nextSaveName();
  if (!canSharePng(name)) {
    warningText.textContent = S.shareUnsupported;
    warningBox.hidden = false;
    return;
  }
  setGenerating(true);
  try {
    const blob = await generatePngBlob();
    if (blob) await sharePng(blob, name);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    warningText.textContent = S.shareUnsupported;
    warningBox.hidden = false;
  }
  setGenerating(false);
});

// ---------- i18n / credits ----------

function applyI18n(): void {
  S = strings(settings.lang);
  document.documentElement.lang = settings.lang === "ja" ? "ja" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n as keyof Strings;
    if (key && S[key]) el.textContent = S[key] as string;
  });
  editorRoot.dataset.placeholder = S.textPlaceholder;
  generatingLabel.textContent = S.generating;
  langButton.textContent = S.langButton;
  versionLabel.textContent = `v${APP_VERSION}`;
  creditsList.innerHTML = "";
  for (const font of BUNDLED_FONTS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = bundledLicenseUrl(font);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = font.licenseLabel;
    li.append(`${font.name} — ${font.author}（`, a, `）`);
    creditsList.appendChild(li);
  }
}

langButton.addEventListener("click", async () => {
  settings.lang = (settings.lang === "ja" ? "en" : "ja") as Lang;
  saveSettings(settings);
  applyI18n();
  renderFontList();
  renderStyleFontOptions();
  refreshStyleBar();
  await validate();
});

creditsButton.addEventListener("click", () => creditsDialog.showModal());
creditsClose.addEventListener("click", () => creditsDialog.close());

// ---------- init ----------

async function init(): Promise<void> {
  applyI18n();
  initPwa();
  families = await listFamilies();
  // Migrate a legacy single-file ref to its family ref.
  const parsed = parseFontRef(settings.fontId);
  if (parsed.kind === "imported") {
    const family = families.find((f) => f.faces.some((face) => face.id === parsed.id));
    if (family) {
      settings.fontId = familyRef(family.id);
      saveSettings(settings);
    }
  }
  baseChoice(); // also normalizes an unresolvable ref
  updateEditorBase();
  renderFontList();
  renderStyleFontOptions();
  initSettingsControls();
  refreshStyleBar();
  setGenerating(false);
  // Keep the magnification honest when the window turns or resizes.
  new ResizeObserver(() => updateEditorBase()).observe(editorRoot);
}

void init();
