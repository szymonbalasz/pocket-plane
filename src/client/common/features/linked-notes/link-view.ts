// Links, dice and styling in the editor, the view side (FR-NOTES-07 – -10, -13, -23; slice N5).
// Chips replace `[[…]]` (title or label; dotted when the note is missing) and are atomic; a click
// follows (never moves the caret), Alt+click shows the raw text. The `@` / `[[` picker is a tooltip
// under the caret. Dice notation gets a die button; headings, bold and lists are styled in place.

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
  WidgetType,
} from "@codemirror/view";
import { findNotation } from "@shared/dice-extras/notation";
import type { NoteLink } from "@shared/linked-notes/links";
import {
  arrowIntoChip,
  backspaceChip,
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
  setPicker,
} from "./link-state";

/** What the window gives the editor. */
export interface LinkHost {
  /** The campaign's live notes now. */
  titles(): readonly PickTitle[];
  /** Live titles by folded title (kept with `titles`). */
  byFold(): ReadonlyMap<string, PickTitle>;
  /** Open the linked note, creating it first when it's missing (FR-NOTES-10). */
  follow(link: Pick<NoteLink, "target" | "fold">): void;
  /** Create a note (`ifMissing`); true when it exists afterwards (FR-NOTES-08's last row). */
  create(title: string): Promise<boolean>;
  /** A die button's click (FR-NOTES-13, -23: labelled "Note"). */
  roll(expression: string, e: MouseEvent): void;
}

/** Live titles changed: chips re-resolve, the picker re-filters. */
export const refreshLinks = StateEffect.define<null>();

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
      this.missing ? `${this.link.target} (no such note yet)` : this.link.target,
    );
    // FR-NOTES-09: a click follows and never moves the caret; Alt+click edits the raw text.
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const at = view.posAtDOM(el);
      const link = chipsOf(view.state).find((l) => l.from === at) ?? this.link;
      if (e.altKey) {
        view.dispatch(revealAt(view.state, link));
        view.focus();
      } else this.host.follow(link);
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const DIE_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';

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
  toDOM(): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-note-die";
    b.dataset.testid = "notes-die";
    b.dataset.value = this.expression;
    b.setAttribute("aria-label", `Roll ${this.expression}`);
    b.innerHTML = DIE_SVG;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      this.host.roll(this.expression, e);
    });
    return b;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const HEADING = /^(#{1,3})[ \t]+\S/;
const LIST = /^[ \t]*(?:[-*]|\d+\.)[ \t]+/;
const BOLD = /\*\*([^*\r\n]+)\*\*/g;
const syntax = Decoration.mark({ class: "cm-note-md" });
const bold = Decoration.mark({ class: "cm-note-bold" });

/** Every decoration of the text: chips, die buttons, headings, bold, list markers. */
function build(state: EditorState, host: LinkHost): DecorationSet {
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
  for (const m of text.matchAll(BOLD)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (inChip(from, to)) continue;
    out.push(syntax.range(from, from + 2), bold.range(from + 2, to - 2), syntax.range(to - 2, to));
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const h = HEADING.exec(line.text);
    if (h) {
      const level = (h[1] as string).length;
      out.push(Decoration.line({ class: `cm-note-h cm-note-h${level}` }).range(line.from));
      out.push(syntax.range(line.from, line.from + level));
      continue;
    }
    const li = LIST.exec(line.text);
    if (li) {
      out.push(Decoration.line({ class: "cm-note-li" }).range(line.from));
      out.push(
        Decoration.mark({ class: "cm-note-li-mark" }).range(line.from, line.from + li[0].length),
      );
    }
  }
  return Decoration.set(out, true);
}

function pickerTooltip(state: EditorState, host: LinkHost): Tooltip | null {
  const p = state.field(pickerField, false);
  if (!p) return null;
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
      const draw = () => {
        const cur = view.state.field(pickerField, false);
        const q = cur ? pickerQuery(view.state, cur) : null;
        dom.replaceChildren();
        if (!cur || q === null) return;
        const rows = pickerRows(q, host.titles());
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
            void choose(view, host, row);
          });
          dom.appendChild(item);
        });
      };
      draw();
      return { dom, update: () => draw() };
    },
  };
}

/** A pick: a note → `[[Title]]`; Create note → the note first, then `[[Title]]`. */
async function choose(view: EditorView, host: LinkHost, row: PickerRow): Promise<void> {
  const p = view.state.field(pickerField, false);
  if (!p) return;
  if (row.kind === "create" && !(await host.create(row.title))) return;
  const now = view.state.field(pickerField, false);
  if (!now || now.from !== p.from) return;
  view.dispatch(pickInsert(view.state, now, row.title));
}

function pickerKeys(host: LinkHost) {
  const move = (d: 1 | -1) => (view: EditorView) => {
    const p = view.state.field(pickerField, false);
    if (!p) return false;
    const q = pickerQuery(view.state, p) ?? "";
    const n = pickerRows(q, host.titles()).length;
    if (n === 0) return false;
    view.dispatch({ effects: setPicker.of({ ...p, index: (p.index + d + n) % n }) });
    return true;
  };
  const accept = (view: EditorView) => {
    const p = view.state.field(pickerField, false);
    if (!p) return false;
    const q = pickerQuery(view.state, p);
    if (q === null) return false;
    const rows = pickerRows(q, host.titles());
    const row = rows[Math.min(p.index, rows.length - 1)];
    if (!row) return false;
    void choose(view, host, row);
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
        if (!view.state.field(pickerField, false)) return false;
        view.dispatch({ effects: setPicker.of(null) });
        return true;
      },
    },
  ]);
}

const theme = EditorView.baseTheme({
  ".cm-note-chip": {
    display: "inline-block",
    padding: "0 6px",
    borderRadius: "9999px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
    lineHeight: "1.35",
    cursor: "pointer",
  },
  ".cm-note-chip-missing": {
    borderStyle: "dotted",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
  },
  ".cm-note-die": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "middle",
    margin: "0 2px",
    padding: "1px",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--primary)",
    cursor: "pointer",
  },
  ".cm-note-md": { color: "var(--muted-foreground)" },
  ".cm-note-bold": { fontWeight: "700" },
  ".cm-note-h": { fontWeight: "700" },
  ".cm-note-h1": { fontSize: "1.3em" },
  ".cm-note-h2": { fontSize: "1.15em" },
  ".cm-note-h3": { fontSize: "1.05em" },
  ".cm-note-li-mark": { color: "var(--primary)" },
  ".cm-tooltip.cm-note-picker, .cm-note-picker": {
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
  ".cm-note-picker-row[aria-selected=true]": { backgroundColor: "var(--accent)" },
});

/** The N5 editor extensions. */
export function noteLinks(host: LinkHost): Extension {
  const decorations = StateField.define<DecorationSet>({
    create: (state) => build(state, host),
    update(set, tr) {
      if (
        tr.docChanged ||
        tr.effects.some((e) => e.is(refreshLinks)) ||
        tr.startState.field(revealField, false) !== tr.state.field(revealField, false)
      )
        return build(tr.state, host);
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
  return [
    revealField,
    pickerField,
    decorations,
    picker,
    Prec.highest(pickerKeys(host)),
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
