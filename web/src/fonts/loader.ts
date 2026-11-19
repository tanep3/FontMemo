// FontFace registry (design §2). A face is fetched/registered only when
// it is first needed (load-on-select rule). Faces of one choice share a
// CSS family name and are told apart by weight/style descriptors, so the
// canvas and the editor pick the right face through normal font matching.

export interface FaceSpec {
  weight: number;
  italic: boolean;
}

const faces = new Map<string, FontFace>();

/** Internal family name; display names never reach CSS directly. */
export function internalFamily(choiceKey: string): string {
  return `fm-${choiceKey.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

function faceKey(choiceKey: string, spec: FaceSpec): string {
  return `${choiceKey}|${spec.weight}|${spec.italic ? "i" : "n"}`;
}

/**
 * Ensure one face of a choice is usable. `source` is a URL (bundled) or
 * the font bytes (imported). Returns the internal family name.
 */
export async function ensureFace(
  choiceKey: string,
  spec: FaceSpec,
  source: string | ArrayBuffer,
): Promise<string> {
  const family = internalFamily(choiceKey);
  const key = faceKey(choiceKey, spec);
  const existing = faces.get(key);
  if (existing) {
    if (existing.status !== "loaded") await existing.load();
    return family;
  }
  const face =
    typeof source === "string"
      ? new FontFace(family, `url("${source}")`, {
          weight: String(spec.weight),
          style: spec.italic ? "italic" : "normal",
        })
      : new FontFace(family, source, {
          weight: String(spec.weight),
          style: spec.italic ? "italic" : "normal",
        });
  faces.set(key, face);
  await face.load();
  document.fonts.add(face);
  return family;
}

export function isFaceLoaded(choiceKey: string, spec: FaceSpec): boolean {
  const face = faces.get(faceKey(choiceKey, spec));
  return face !== undefined && face.status === "loaded";
}

/**
 * Pick the best face for a (bold, italic) request, CSS-matching style:
 * italic mismatch is the worst, then weight distance (for bold requests
 * an equal distance prefers the heavier face).
 */
export function pickFace<T extends FaceSpec>(available: T[], bold: boolean, italic: boolean): T {
  const targetWeight = bold ? 700 : 400;
  let best = available[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const face of available) {
    let score = Math.abs(face.weight - targetWeight);
    if (face.italic !== italic) score += 10000;
    if (bold && face.weight > targetWeight) score -= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = face;
    }
  }
  return best;
}

/** Does this face set offer a genuinely bolder face than its regular? */
export function hasBoldFace(available: FaceSpec[]): boolean {
  const regular = pickFace(available, false, false);
  const bold = pickFace(available, true, false);
  return bold.weight > regular.weight;
}

export function hasItalicFace(available: FaceSpec[]): boolean {
  return available.some((f) => f.italic);
}

/** Device fonts the fallback chain may rely on (they ship with the OSes). */
export const FALLBACK_STACK = [
  '"Hiragino Sans"',
  '"Hiragino Kaku Gothic ProN"',
  '"Noto Sans JP"',
  '"Yu Gothic UI"',
  '"Yu Gothic"',
  "Meiryo",
  "sans-serif",
].join(", ");

export function fontStack(family: string | null): string {
  return family ? `"${family}", ${FALLBACK_STACK}` : FALLBACK_STACK;
}

/** Full CSS font shorthand for canvas/editor use of one resolved face. */
export function cssFont(spec: FaceSpec, sizePx: number, stack: string): string {
  return `${spec.italic ? "italic " : ""}${spec.weight} ${sizePx}px ${stack}`;
}
