// The WYSIWYG editor (v0.2): a contenteditable element whose spans carry
// per-range styles in data attributes. The DOM is the source of truth;
// the print pipeline reads it through readSegments(). The DOM is only
// rewritten on explicit style operations (never per keystroke), so the
// caret and IME composition are left alone while typing.

import {
  mergeSegments,
  applyStylePatch,
  cpLength,
  type RunStyle,
  type StylePatch,
  type TextSegment,
} from "../core/runs";

export type { TextSegment };

export type ParaAlign = "left" | "center" | "right";

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "BLOCKQUOTE"]);

function isParaAlign(v: string | undefined): v is ParaAlign {
  return v === "left" || v === "center" || v === "right";
}

/** Number of "\n" among the first cp code points of text. */
function breaksBefore(text: string, cp: number): number {
  let n = 0;
  let seen = 0;
  for (const ch of text) {
    if (seen >= cp) break;
    if (ch === "\n") n++;
    seen++;
  }
  return n;
}

export class Editor {
  private root: HTMLElement;
  private composing = false;
  private changeCbs: Array<() => void> = [];
  /** Set by the app: applies display CSS to a span from its style. */
  decorate: (span: HTMLSpanElement, style: RunStyle) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    root.addEventListener("compositionend", () => {
      this.composing = false;
      this.emitChange();
    });
    root.addEventListener("input", () => {
      if (!this.composing) this.emitChange();
    });
    root.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) document.execCommand("insertText", false, text);
    });
    root.addEventListener("keydown", (e) => {
      // The app's own bold/italic buttons do styling; stop the browser's
      // built-in rich-text shortcuts from creating <b>/<i> elements.
      if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });
  }

  get isComposing(): boolean {
    return this.composing;
  }

  onChange(cb: () => void): void {
    this.changeCbs.push(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeCbs) cb();
  }

  // ---------- style <-> dataset ----------

  private styleOf(span: HTMLElement): RunStyle {
    const style: RunStyle = {};
    const d = span.dataset;
    if (d.f) style.fontRef = d.f;
    if (d.s) style.size = Number(d.s);
    if (d.b) style.bold = true;
    if (d.i) style.italic = true;
    return style;
  }

  private writeDataset(span: HTMLSpanElement, style: RunStyle): void {
    const d = span.dataset;
    delete d.f;
    delete d.s;
    delete d.b;
    delete d.i;
    if (style.fontRef) d.f = style.fontRef;
    if (style.size !== undefined) d.s = String(style.size);
    if (style.bold) d.b = "1";
    if (style.italic) d.i = "1";
  }

  // ---------- reading ----------

  /**
   * Paragraphs as node lists. Browsers shape contenteditable DOMs
   * inconsistently — bare text mixed with <div> lines is normal on
   * Android Chrome — so each block-level child is one paragraph and
   * each run of inline children forms an implicit paragraph.
   */
  private paragraphNodes(): Node[][] {
    const paragraphs: Node[][] = [];
    let current: Node[] = [];
    const flush = () => {
      if (current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
    };
    this.root.childNodes.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as HTMLElement).tagName)) {
        flush();
        paragraphs.push([child]);
      } else {
        current.push(child);
      }
    });
    flush();
    return paragraphs.length > 0 ? paragraphs : [[]];
  }

  private walkNodes(nodes: Node[], style: RunStyle, out: TextSegment[]): void {
    for (const child of nodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) out.push({ text, style });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.tagName === "BR") {
          out.push({ text: "\n", style });
        } else if (el.tagName === "SPAN") {
          this.walkNodes(Array.from(el.childNodes), { ...style, ...this.styleOf(el) }, out);
        } else {
          this.walkNodes(Array.from(el.childNodes), style, out);
        }
      }
    }
  }

  /** The document as styled segments (paragraphs joined by "\n"). */
  readSegments(): TextSegment[] {
    const raw: TextSegment[] = [];
    this.paragraphNodes().forEach((nodes, idx) => {
      if (idx > 0) raw.push({ text: "\n", style: {} });
      this.walkNodes(nodes, {}, raw);
    });
    return mergeSegments(raw);
  }

  /**
   * Alignment per layout paragraph (the text split on "\n"), parallel
   * to how readSegments shapes the text: a block element's data-a
   * covers every layout paragraph inside it (including <br> breaks);
   * blocks without one yield undefined (the caller's default applies).
   */
  readAligns(): Array<ParaAlign | undefined> {
    const aligns: Array<ParaAlign | undefined> = [];
    this.paragraphNodes().forEach((nodes) => {
      let align: ParaAlign | undefined;
      if (
        nodes.length === 1 &&
        nodes[0].nodeType === Node.ELEMENT_NODE &&
        BLOCK_TAGS.has((nodes[0] as HTMLElement).tagName)
      ) {
        const v = (nodes[0] as HTMLElement).dataset.a;
        if (isParaAlign(v)) align = v;
      }
      aligns.push(align);
      const count = (list: Node[]): void => {
        for (const child of list) {
          if (child.nodeType === Node.TEXT_NODE) {
            for (const ch of child.textContent ?? "") {
              if (ch === "\n") aligns.push(align);
            }
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            if (el.tagName === "BR") aligns.push(align);
            else count(Array.from(el.childNodes));
          }
        }
      };
      count(nodes);
    });
    return aligns;
  }

  /** The explicit alignment of the layout paragraph containing cp. */
  alignAt(cp: number): ParaAlign | undefined {
    return this.readAligns()[breaksBefore(this.plainText(), cp)];
  }

  /**
   * Set the alignment of every layout paragraph the cp range touches
   * (a collapsed range touches its own paragraph). Rebuilds the DOM in
   * canonical form — one block per layout paragraph — like the other
   * style operations.
   */
  applyAlignToRange(start: number, end: number, align: ParaAlign): void {
    const segments = this.readSegments();
    const aligns = this.readAligns();
    const text = segments.map((s) => s.text).join("");
    const first = breaksBefore(text, start);
    const last = breaksBefore(text, end > start ? end - 1 : end);
    for (let i = first; i <= last; i++) aligns[i] = align;
    this.rewrite(segments, aligns);
    this.setSelection(start, end);
    this.emitChange();
  }

  plainText(): string {
    return this.readSegments()
      .map((s) => s.text)
      .join("");
  }

  isEmpty(): boolean {
    return this.plainText().trim() === "";
  }

  /** Re-apply display CSS to every span (after fonts load, etc.). */
  redecorate(): void {
    this.root.querySelectorAll<HTMLSpanElement>("span").forEach((span) => {
      this.decorate(span, this.styleOf(span));
    });
  }

  /** True when some visible text sits outside any span (fresh typing
   *  or a paste that no style operation has canonicalized yet). */
  hasBareText(): boolean {
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node.textContent ?? "").trim() === "") continue;
      let p: Node | null = node.parentNode;
      let inSpan = false;
      while (p && p !== this.root) {
        if ((p as HTMLElement).tagName === "SPAN") {
          inSpan = true;
          break;
        }
        p = p.parentNode;
      }
      if (!inSpan) return true;
    }
    return false;
  }

  // ---------- selection mapping (code-point offsets) ----------

  /** Text nodes in document order with the cp offset where each starts. */
  private textNodeTable(): Array<{ node: Text; startCp: number }> {
    const table: Array<{ node: Text; startCp: number }> = [];
    let cp = 0;
    this.paragraphNodes().forEach((nodes, idx) => {
      if (idx > 0) cp += 1; // the paragraph break
      const walk = (list: Node[]): void => {
        for (const child of list) {
          if (child.nodeType === Node.TEXT_NODE) {
            table.push({ node: child as Text, startCp: cp });
            cp += cpLength(child.textContent ?? "");
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            if (el.tagName === "BR") cp += 1;
            else walk(Array.from(el.childNodes));
          }
        }
      };
      walk(nodes);
    });
    return table;
  }

  private cpOfTextPosition(node: Text, utf16Offset: number): number | null {
    const table = this.textNodeTable();
    const entry = table.find((e) => e.node === node);
    if (!entry) return null;
    const before = (node.textContent ?? "").slice(0, utf16Offset);
    return entry.startCp + cpLength(before);
  }

  private cpOfPosition(container: Node, offset: number): number | null {
    if (container.nodeType === Node.TEXT_NODE) {
      return this.cpOfTextPosition(container as Text, offset);
    }
    // Element container: measure the contents before the position by
    // flattening a cloned range (same rules as readSegments).
    try {
      const range = document.createRange();
      range.selectNodeContents(this.root);
      range.setEnd(container, offset);
      const frag = range.cloneContents();
      const holder = document.createElement("div");
      holder.appendChild(frag);
      const probe = new Editor(holder);
      let cp = cpLength(probe.plainText());
      // A position right after a complete block also passes its break.
      if (offset > 0 && container === this.root) {
        const prev = this.root.childNodes[offset - 1];
        if (prev && prev.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((prev as HTMLElement).tagName)) {
          cp += 1;
        }
      }
      return cp;
    } catch {
      return null;
    }
  }

  /** Current selection as code-point offsets, or null when not usable. */
  selectionRange(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!this.root.contains(range.startContainer) || !this.root.contains(range.endContainer)) {
      return null;
    }
    const start = this.cpOfPosition(range.startContainer, range.startOffset);
    const end = this.cpOfPosition(range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  private locate(cpTarget: number): { node: Text; offset: number } | null {
    const table = this.textNodeTable();
    for (const entry of table) {
      const text = entry.node.textContent ?? "";
      const len = cpLength(text);
      if (cpTarget <= entry.startCp + len) {
        // Convert the cp offset inside this node to a UTF-16 offset.
        let remaining = cpTarget - entry.startCp;
        let u16 = 0;
        for (const ch of text) {
          if (remaining <= 0) break;
          u16 += ch.length;
          remaining--;
        }
        return { node: entry.node, offset: u16 };
      }
    }
    const last = table[table.length - 1];
    if (last) return { node: last.node, offset: (last.node.textContent ?? "").length };
    return null;
  }

  setSelection(start: number, end: number): void {
    const a = this.locate(start);
    const b = this.locate(end);
    if (!a || !b) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- writing ----------

  /** Rebuild the editor DOM from segments (used on style operations). */
  rewrite(segments: TextSegment[], aligns?: ReadonlyArray<ParaAlign | undefined>): void {
    const merged = mergeSegments(segments);
    this.root.innerHTML = "";
    // Split into paragraphs, keeping each piece's style.
    const paragraphs: TextSegment[][] = [[]];
    for (const seg of merged) {
      const parts = seg.text.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) paragraphs.push([]);
        if (part) paragraphs[paragraphs.length - 1].push({ text: part, style: seg.style });
      });
    }
    for (const [paraIdx, para] of paragraphs.entries()) {
      const div = document.createElement("div");
      const align = aligns?.[paraIdx];
      if (align) {
        div.dataset.a = align;
        div.style.textAlign = align;
      }
      if (para.length === 0) {
        div.appendChild(document.createElement("br"));
      } else {
        // Every run lives in a span (even an unstyled one) so display
        // decoration — e.g. missing-glyph marks — can reach all text.
        for (const seg of para) {
          const span = document.createElement("span");
          span.textContent = seg.text;
          this.writeDataset(span, seg.style);
          this.decorate(span, seg.style);
          div.appendChild(span);
        }
      }
      this.root.appendChild(div);
    }
  }

  /**
   * Apply a style patch to the current selection. Returns false when
   * there is no (non-collapsed) selection inside the editor.
   */
  applyToSelection(patch: StylePatch): boolean {
    const selRange = this.selectionRange();
    if (!selRange || selRange.end <= selRange.start) return false;
    return this.applyToRange(selRange.start, selRange.end, patch);
  }

  /**
   * Apply a style patch to an explicit code-point range. The app keeps
   * the last selection around because on mobile the live DOM selection
   * collapses as soon as a style control is tapped.
   */
  applyToRange(start: number, end: number, patch: StylePatch): boolean {
    if (end <= start) return false;
    const segments = this.readSegments();
    const next = applyStylePatch(segments, start, end, patch);
    this.rewrite(next);
    this.setSelection(start, end);
    this.emitChange();
    return true;
  }
}
