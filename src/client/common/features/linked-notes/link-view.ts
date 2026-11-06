// Links, dice and styling in the editor, the view side (FR-NOTES-07 – -10, -13, -23; slice N5).
// Chips replace `[[…]]` (title or label; dashed and muted when the note is missing) and are atomic;
// a click follows (never moves the caret), Alt+click or a long-press on touch shows the raw text.
// The `@` / `[[` picker is a tooltip under the caret. Dice notation gets a die button. Headings,
// bold and lists show as a live preview (Obsidian style): their markers hide off the caret's line.
// Hover hints use the kit Tooltip's bubble (`data-slot="tooltip-content"`, same classes, 400 ms).

import {
  type EditorState,
  type Extension,
  Prec,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  tooltips,
  WidgetType,
} from "@codemirror/view";
import { findNotation } from "@shared/dice-extras/notation";
import type { NoteLink } from "@shared/linked-notes/links";
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABEL,
  type NoteCategory,
} from "@shared/linked-notes/schemas";
import { POPOVER_Z } from "../../components/ui/layers";
import {
  arrowIntoChip,
  backspaceChip,
  type CategoryAsk,
  categoryField,
  chipsOf,
  deleteChip,
  type PickerRow,
  type PickTitle,
  pickerField,
  pickerQuery,
  pickerRows,
  pickInsert,
  resolveLink,
  revealAt,
  revealField,
  setCategoryAsk,
  setPicker,
} from "./link-state";

/** What the window gives the editor. */
export interface LinkHost {
  /** The campaign's live notes now. */
  titles(): readonly PickTitle[];
  /** Live titles by folded title (kept with `titles`). */
  byFold(): ReadonlyMap<string, PickTitle>;
  /** Open the linked note; false when it's missing (the chip then asks its category). */
  follow(link: Pick<NoteLink, "target" | "fold">): boolean;
  /** Create a note (`ifMissing`); true when it exists afterwards (FR-NOTES-08's last row, -25). */
  create(title: string, category: NoteCategory): Promise<boolean>;
  /** FR-NOTES-10, -25: create a missing chip's note (`ifMissing`) of `category` and open it. */
  createAndOpen(title: string, category: NoteCategory): void;
  /** A die button's click (FR-NOTES-13, -23: labelled "Note"). */
  roll(expression: string, e: MouseEvent): void;
}

/** Live titles changed: chips re-resolve, the picker re-filters. */
export const refreshLinks = StateEffect.define<null>();

/** Hover hints' wait, as the kit Tooltip (`TOOLTIP_DELAY_MS`). */
export const HINT_DELAY_MS = 400;
/** FR-NOTES-09: a press this long on touch edits a chip's raw text. */
export const LONG_PRESS_MS = 500;
export const CHIP_HINT = "Open · Alt+click to edit";
export const MISSING_HINT = "No note yet · click to create";
/** N8: the category step's first line. */
export const categoryPrompt = (title: string) => `Category for "${title}"`;
export const dieHint = (expression: string) => `Roll ${expression}`;

// ---------- hover hints (the kit Tooltip's bubble on editor parts) ----------

const setHint = StateEffect.define<{ pos: number; text: string } | null>();

const hintField = StateField.define<{ pos: number; text: string } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHint)) return e.value;
    if (!value) return null;
    return tr.docChanged ? null : value;
  },
  provide: (f) =>
    showTooltip.from(f, (hint) =>
      hint === null
        ? null
        : {
            pos: hint.pos,
            above: true,
            arrow: false,
            create() {
              const dom = document.createElement("div");
              dom.dataset.slot = "tooltip-content";
              dom.dataset.testid = "ui-tooltip";
              dom.className =
                "cm-note-hint rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground";
              dom.textContent = hint.text;
              return { dom };
            },
          },
    ),
});

/** Shows `text` over `el` after the kit's delay while the pointer rests on it. */
function hoverHint(view: EditorView, el: HTMLElement, text: () => string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    timer = setTimeout(() => {
      timer = null;
      if (el.isConnected)
        view.dispatch({ effects: setHint.of({ pos: view.posAtDOM(el), text: text() }) });
    }, HINT_DELAY_MS);
  });
  el.addEventListener("pointerleave", () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (view.state.field(hintField, false)) view.dispatch({ effects: setHint.of(null) });
  });
}

// ---------- chips ----------

class Chip extends WidgetType {
  constructor(
    readonly link: NoteLink,
    readonly missing: boolean,
    readonly host: LinkHost,
  ) {
    super();
  }
  override eq(o: Chip): boolean {
    return (
      o.link.target === this.link.target &&
      o.link.label === this.link.label &&
      o.missing === this.missing
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = this.missing ? "cm-note-chip cm-note-chip-missing" : "cm-note-chip";
    el.textContent = this.link.label ?? this.link.target;
    el.dataset.testid = "notes-link";
    el.dataset.title = this.link.target;
    el.dataset.missing = String(this.missing);
    el.setAttribute("role", "link");
    el.setAttribute(
      "aria-label",
      this.missing ? `${this.link.target}: ${MISSING_HINT}` : `${this.link.target}: ${CHIP_HINT}`,
    );
    const current = () => {
      const at = view.posAtDOM(el);
      return chipsOf(view.state).find((l) => l.from === at) ?? this.link;
    };
    const edit = () => {
      view.dispatch(revealAt(view.state, current()));
      view.focus();
    };
    // FR-NOTES-09: a tap follows; a long-press edits the raw text (touch).
    let pointer = "mouse";
    let press: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (press) clearTimeout(press);
      press = null;
    };
    el.addEventListener("pointerdown", (e) => {
      pointer = e.pointerType;
      if (e.pointerType !== "touch") return;
      cancel();
      press = setTimeout(() => {
        press = null;
        edit();
      }, LONG_PRESS_MS);
    });
    // FR-NOTES-10, -25: a live note opens; a missing one asks its category first.
    const follow = () => {
      const link = current();
      if (this.host.follow(link)) return;
      view.dispatch({
        effects: [
          setPicker.of(null),
          setCategoryAsk.of({ title: link.target, pos: link.from, after: "open", index: 0 }),
        ],
      });
      view.focus();
    };
    el.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" || !press) return;
      cancel();
      follow();
    });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("contextmenu", (e) => {
      if (pointer === "touch") e.preventDefault();
    });
    // A click follows and never moves the caret; Alt+click edits the raw text.
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (pointer === "touch") return;
      if (e.altKey) edit();
      else follow();
    });
    hoverHint(view, el, () => (this.missing ? MISSING_HINT : CHIP_HINT));
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

// ---------- die buttons ----------

const DIE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';

class Die extends WidgetType {
  constructor(
    readonly expression: string,
    readonly host: LinkHost,
  ) {
    super();
  }
  override eq(o: Die): boolean {
    return o.expression === this.expression;
  }
  toDOM(view: EditorView): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-note-die";
    b.dataset.testid = "notes-die";
    b.dataset.value = this.expression;
    b.setAttribute("aria-label", dieHint(this.expression));
    b.innerHTML = DIE_SVG;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      this.host.roll(this.expression, e);
    });
    hoverHint(view, b, () => dieHint(this.expression));
    return b;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class Bullet extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    // The slot is the raw marker's width at the text's size; the dot inside is larger.
    const s = document.createElement("span");
    s.className = "cm-note-bullet";
    s.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = "cm-note-bullet-dot";
    dot.textContent = "•";
    s.appendChild(dot);
    return s;
  }
}

// ---------- live preview ----------

const HEADING = /^(#{1,3})([ \t]+)\S/;
const BULLET = /^([ \t]*)([-*])([ \t]+)/;
const NUMBERED = /^([ \t]*)(\d+\.)([ \t]+)/;
const BOLD = /\*\*([^*\r\n]+)\*\*/g;
const syntax = Decoration.mark({ class: "cm-note-md" });
const hide = Decoration.replace({});
const bold = Decoration.mark({ class: "cm-note-bold" });
const bullet = Decoration.replace({ widget: new Bullet() });
const listMark = Decoration.mark({ class: "cm-note-li-mark" });
/** Nesting: a tab or two spaces per level (at most 4). */
export const listLevel = (indent: string) =>
  Math.min(4, Math.floor(indent.replace(/\t/g, "  ").length / 2));
const listClass = (indent: string) => `cm-note-li cm-note-li-${listLevel(indent)}`;

/** r1: whether the editor has focus; until it does, every line shows its preview. */
const setFocused = StateEffect.define<boolean>();
export const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) return e.value;
    return value;
  },
});

/**
 * The lines a selection touches: their markdown markers show as typed (live preview). None while
 * the editor doesn't have focus (r1: an opened note shows line 1's heading styled). A state
 * without the focus field (tests) counts as focused.
 */
export function caretLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  if (state.field(focusField, false) === false) return out;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

/**
 * Every decoration of the text: chips, die buttons, and the live preview: off the caret's lines
 * the `#` / `**` markers hide and list markers become a bullet (numbers stay), with an indent; on
 * them the markers show, muted, to edit.
 */
export function buildDecorations(state: EditorState, host: LinkHost): DecorationSet {
  const out: Range<Decoration>[] = [];
  const chips = chipsOf(state);
  const byFold = host.byFold();
  for (const l of chips)
    out.push(
      Decoration.replace({ widget: new Chip(l, resolveLink(l, byFold) === null, host) }).range(
        l.from,
        l.to,
      ),
    );
  const text = state.doc.toString();
  const inChip = (a: number, b: number) => chips.some((l) => a < l.to && b > l.from);
  for (const m of findNotation(text)) {
    if (inChip(m.start, m.end)) continue;
    out.push(Decoration.widget({ widget: new Die(m.expression, host), side: 1 }).range(m.end));
  }
  const caret = caretLines(state);
  const preview = (pos: number) => !caret.has(state.doc.lineAt(pos).number);
  for (const m of text.matchAll(BOLD)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (inChip(from, to)) continue;
    const marker = preview(from) ? hide : syntax;
    out.push(marker.range(from, from + 2), bold.range(from + 2, to - 2), marker.range(to - 2, to));
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const live = !caret.has(n);
    const h = HEADING.exec(line.text);
    if (h) {
      const level = (h[1] as string).length;
      out.push(Decoration.line({ class: `cm-note-h cm-note-h${level}` }).range(line.from));
      const end = line.from + level + (h[2] as string).length;
      out.push(live ? hide.range(line.from, end) : syntax.range(line.from, line.from + level));
      continue;
    }
    const b = BULLET.exec(line.text);
    if (b) {
      const indent = b[1] as string;
      out.push(Decoration.line({ class: listClass(indent) }).range(line.from));
      const at = line.from + indent.length;
      const end = at + (b[2] as string).length + (b[3] as string).length;
      // Off the caret's line the indent is the line's padding (one clear step per level).
      if (live && indent.length > 0) out.push(hide.range(line.from, at));
      out.push(live ? bullet.range(at, end) : listMark.range(at, end));
      continue;
    }
    const num = NUMBERED.exec(line.text);
    if (num) {
      const indent = num[1] as string;
      out.push(Decoration.line({ class: listClass(indent) }).range(line.from));
      const at = line.from + indent.length;
      if (live && indent.length > 0) out.push(hide.range(line.from, at));
      out.push(listMark.range(at, at + (num[2] as string).length + (num[3] as string).length));
    }
  }
  return Decoration.set(out, true);
}

// ---------- the picker ----------

function pickerTooltip(state: EditorState, host: LinkHost): Tooltip | null {
  const p = state.field(pickerField, false);
  if (!p || state.field(categoryField, false)) return null;
  const query = pickerQuery(state, p);
  if (query === null) return null;
  return {
    pos: state.selection.main.head,
    above: false,
    strictSide: false,
    arrow: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-note-picker";
      dom.dataset.testid = "notes-picker";
      dom.setAttribute("role", "listbox");
      let drawn = "";
      const draw = () => {
        const cur = view.state.field(pickerField, false);
        const q = cur ? pickerQuery(view.state, cur) : null;
        if (!cur || q === null) {
          dom.replaceChildren();
          drawn = "";
          return;
        }
        const rows = pickerRows(q, host.titles());
        // r2: the same rows → only the highlight moves (the row under the pointer stays put).
        const key = rows
          .map((r) => `${r.kind}:${r.kind === "note" ? r.id : ""}:${r.title}`)
          .join("|");
        if (key === drawn) {
          highlight(dom, Math.min(cur.index, rows.length - 1));
          return;
        }
        drawn = key;
        dom.replaceChildren();
        rows.forEach((row, i) => {
          const item = document.createElement("div");
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(i === Math.min(cur.index, rows.length - 1)));
          item.className = "cm-note-picker-row";
          item.dataset.testid = row.kind === "create" ? "notes-picker-create" : "notes-picker-item";
          if (row.kind === "note") item.dataset.recordId = row.id;
          item.textContent = row.kind === "create" ? `Create note "${row.title}"` : row.title;
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            choose(view, row);
          });
          // r2: the pointer highlights a row as the arrows do; Enter then takes it.
          item.addEventListener("mousemove", () => {
            const p = view.state.field(pickerField, false);
            if (p && p.index !== i) view.dispatch({ effects: setPicker.of({ ...p, index: i }) });
          });
          dom.appendChild(item);
        });
        showHighlighted(dom);
      };
      draw();
      return { dom, update: () => draw() };
    },
  };
}

/** r2: marks row `index` of `dom`'s options highlighted, in place, and keeps it in view. */
function highlight(dom: HTMLElement, index: number): void {
  dom.querySelectorAll('[role="option"]').forEach((el, i) => {
    el.setAttribute("aria-selected", String(i === index));
  });
  showHighlighted(dom);
}

/** r1: the highlighted row stays in view when the list scrolls (a short viewport). */
function showHighlighted(dom: HTMLElement): void {
  dom.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
}

/** A pick: a note → `[[Title]]`; Create note → its category first (N8, FR-NOTES-25). */
function choose(view: EditorView, row: PickerRow): void {
  const p = view.state.field(pickerField, false);
  if (!p) return;
  if (row.kind === "create") {
    const pos = view.state.selection.main.head;
    view.dispatch({
      effects: setCategoryAsk.of({ title: row.title, pos, after: "link", index: 0 }),
    });
    return;
  }
  view.dispatch(pickInsert(view.state, p, row.title));
}

/**
 * The category step's pick: `link` → the note (`ifMissing`), then `[[Title]]` in place of the
 * picker's text, if the picker is still there; `open` → create and open it.
 */
async function chooseCategory(
  view: EditorView,
  host: LinkHost,
  ask: CategoryAsk,
  category: NoteCategory,
): Promise<void> {
  if (ask.after === "open") {
    view.dispatch({ effects: setCategoryAsk.of(null) });
    host.createAndOpen(ask.title, category);
    return;
  }
  const p = view.state.field(pickerField, false);
  if (!p) return;
  const made = await host.create(ask.title, category);
  const now = view.state.field(pickerField, false);
  if (!made || !now || now.from !== p.from) {
    if (view.state.field(categoryField, false)) view.dispatch({ effects: setCategoryAsk.of(null) });
    return;
  }
  view.dispatch(pickInsert(view.state, now, ask.title));
}

/** N8: the eight categories in the picker's popup, Session first and highlighted. */
function categoryTooltip(state: EditorState, host: LinkHost): Tooltip | null {
  const ask = state.field(categoryField, false);
  if (!ask) return null;
  return {
    pos: Math.min(ask.pos, state.doc.length),
    above: false,
    strictSide: false,
    arrow: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-note-picker";
      dom.dataset.testid = "notes-picker";
      dom.dataset.step = "category";
      const head = document.createElement("div");
      head.className = "cm-note-picker-head";
      dom.appendChild(head);
      const list = document.createElement("div");
      list.setAttribute("role", "listbox");
      dom.appendChild(list);
      let drawn: string | null = null;
      const draw = () => {
        const cur = view.state.field(categoryField, false);
        if (!cur) {
          list.replaceChildren();
          drawn = null;
          return;
        }
        // r2: the same note → only the highlight moves (the row under the pointer stays put).
        if (cur.title === drawn) {
          highlight(list, cur.index);
          return;
        }
        drawn = cur.title;
        list.replaceChildren();
        head.textContent = categoryPrompt(cur.title);
        list.setAttribute("aria-label", categoryPrompt(cur.title));
        NOTE_CATEGORIES.forEach((category, i) => {
          const item = document.createElement("div");
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(i === cur.index));
          item.className = "cm-note-picker-row";
          item.dataset.testid = "notes-category-pick";
          item.dataset.category = category;
          item.textContent = NOTE_CATEGORY_LABEL[category];
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const now = view.state.field(categoryField, false);
            if (now) void chooseCategory(view, host, now, category);
          });
          // r2: the pointer highlights a row as the arrows do; Enter then takes it.
          item.addEventListener("mousemove", () => {
            const a = view.state.field(categoryField, false);
            if (a && a.index !== i)
              view.dispatch({ effects: setCategoryAsk.of({ ...a, index: i }) });
          });
          list.appendChild(item);
        });
        showHighlighted(dom);
      };
      draw();
      return { dom, update: () => draw() };
    },
  };
}

function pickerKeys(host: LinkHost) {
  // N8: while the category step shows, the keys are its own.
  const ask = (view: EditorView) => view.state.field(categoryField, false);
  const moveCategory = (view: EditorView, d: 1 | -1) => {
    const a = ask(view);
    if (!a) return false;
    const n = NOTE_CATEGORIES.length;
    view.dispatch({ effects: setCategoryAsk.of({ ...a, index: (a.index + d + n) % n }) });
    return true;
  };
  const acceptCategory = (view: EditorView) => {
    const a = ask(view);
    if (!a) return false;
    void chooseCategory(view, host, a, NOTE_CATEGORIES[a.index] ?? "session");
    return true;
  };
  const move = (d: 1 | -1) => (view: EditorView) => {
    if (moveCategory(view, d)) return true;
    const p = view.state.field(pickerField, false);
    if (!p) return false;
    const q = pickerQuery(view.state, p) ?? "";
    const n = pickerRows(q, host.titles()).length;
    if (n === 0) return false;
    view.dispatch({ effects: setPicker.of({ ...p, index: (p.index + d + n) % n }) });
    return true;
  };
  const accept = (view: EditorView) => {
    if (acceptCategory(view)) return true;
    const p = view.state.field(pickerField, false);
    if (!p) return false;
    const q = pickerQuery(view.state, p);
    if (q === null) return false;
    const rows = pickerRows(q, host.titles());
    const row = rows[Math.min(p.index, rows.length - 1)];
    if (!row) return false;
    choose(view, row);
    return true;
  };
  return keymap.of([
    { key: "ArrowDown", run: move(1) },
    { key: "ArrowUp", run: move(-1) },
    { key: "Enter", run: accept },
    { key: "Tab", run: accept },
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(pickerField, false) && !ask(view)) return false;
        view.dispatch({ effects: [setPicker.of(null), setCategoryAsk.of(null)] });
        return true;
      },
    },
  ]);
}

const theme = EditorView.baseTheme({
  // Tight, so punctuation sits right after it ("Duke Varen's").
  ".cm-note-chip": {
    padding: "0 3px",
    borderRadius: "4px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
    cursor: "pointer",
  },
  // "No note yet": dashed and muted, no fill, reads at a glance in every theme.
  ".cm-note-chip-missing": {
    borderStyle: "dashed",
    borderColor: "var(--muted-foreground)",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  // The kit's minimum hit target (24 px), without growing the line.
  ".cm-note-die": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    minWidth: "24px",
    minHeight: "24px",
    margin: "-6px 1px",
    padding: "0",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--primary)",
    cursor: "pointer",
  },
  ".cm-note-die:hover": { backgroundColor: "var(--accent)" },
  ".cm-note-md": { color: "var(--muted-foreground)" },
  ".cm-note-bold": { fontWeight: "700" },
  ".cm-note-h": { fontWeight: "700" },
  ".cm-note-h1": { fontSize: "1.3em" },
  ".cm-note-h2": { fontSize: "1.15em" },
  ".cm-note-h3": { fontSize: "1.05em" },
  // r1: the marker keeps one width as text or as a bullet, so the item's text never moves;
  // each nesting level indents one clear step.
  ".cm-note-li": { paddingLeft: "1.6em !important", textIndent: "-1.4em" },
  ".cm-note-li-1": { paddingLeft: "3.1em !important" },
  ".cm-note-li-2": { paddingLeft: "4.6em !important" },
  ".cm-note-li-3": { paddingLeft: "6.1em !important" },
  ".cm-note-li-4": { paddingLeft: "7.6em !important" },
  ".cm-note-bullet, .cm-note-li-mark": {
    display: "inline-block",
    minWidth: "1.4em",
    textIndent: "0",
    color: "var(--primary)",
  },
  ".cm-note-bullet-dot": { fontSize: "1.25em", fontWeight: "700", lineHeight: "1" },
  // r1: drawn in the page's popover layer (not clipped by the editor's box); scrolls in a short
  // viewport, its highlighted row kept in view.
  ".cm-tooltip.cm-note-picker, .cm-note-picker": {
    zIndex: String(POPOVER_Z),
    maxHeight: "min(70vh, 360px)",
    overflowY: "auto",
    minWidth: "200px",
    maxWidth: "320px",
    padding: "4px",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    fontSize: "0.875rem",
  },
  ".cm-note-picker-row": { padding: "3px 8px", borderRadius: "4px", cursor: "pointer" },
  ".cm-note-picker-head": {
    padding: "2px 8px 4px",
    fontSize: "0.75rem",
    color: "var(--muted-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-note-picker-row[aria-selected=true]": { backgroundColor: "var(--accent)" },
  ".cm-tooltip.cm-note-hint": { border: "none", zIndex: String(POPOVER_Z) },
});

const linesKey = (state: EditorState) => [...caretLines(state)].join(",");

/** The N5 editor extensions. */
export function noteLinks(host: LinkHost): Extension {
  const decorations = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, host),
    update(set, tr) {
      if (
        tr.docChanged ||
        tr.effects.some((e) => e.is(refreshLinks)) ||
        tr.startState.field(revealField, false) !== tr.state.field(revealField, false) ||
        tr.effects.some((e) => e.is(setFocused)) ||
        (tr.selection && linesKey(tr.startState) !== linesKey(tr.state))
      )
        return buildDecorations(tr.state, host);
      return set;
    },
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => {
        const chips = chipsOf(view.state);
        return Decoration.set(chips.map((l) => Decoration.mark({}).range(l.from, l.to)));
      }),
    ],
  });
  const picker = StateField.define<Tooltip | null>({
    create: (state) => pickerTooltip(state, host),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !tr.effects.length) return value;
      return pickerTooltip(tr.state, host);
    },
    provide: (f) => showTooltip.from(f),
  });
  // N8: one tooltip per open step; a highlight move only redraws it.
  const category = StateField.define<Tooltip | null>({
    create: (state) => categoryTooltip(state, host),
    update(value, tr) {
      const before = tr.startState.field(categoryField, false);
      const after = tr.state.field(categoryField, false);
      if (before === after) return value;
      if (before && after && before.title === after.title && before.pos === after.pos) return value;
      return categoryTooltip(tr.state, host);
    },
    provide: (f) => showTooltip.from(f),
  });
  return [
    revealField,
    pickerField,
    categoryField,
    focusField,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
    hintField,
    decorations,
    picker,
    category,
    Prec.highest(pickerKeys(host)),
    // r1: the picker, the category step and hints sit in the page (fixed), above the windows, so
    // the editor's framed box never clips them; CodeMirror flips them above when there's no room.
    typeof document === "undefined" ? [] : tooltips({ parent: document.body, position: "fixed" }),
    Prec.high(
      keymap.of([
        { key: "Backspace", run: backspaceChip },
        { key: "Delete", run: deleteChip },
        { key: "ArrowLeft", run: arrowIntoChip(-1) },
        { key: "ArrowRight", run: arrowIntoChip(1) },
      ]),
    ),
    theme,
  ];
}
