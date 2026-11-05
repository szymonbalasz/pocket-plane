// Links in the editor, the state side (FR-NOTES-07 – -10; slice N5). No DOM: the `@` / `[[` title
// picker (when it opens, its query, its rows, what a pick inserts), the "revealed" link shown as raw
// `[[…]]` text (Alt+click, or arrowing into a chip, until the caret leaves), and the chip keys:
// Backspace just after a chip / Delete just before it remove it whole. The view side draws.
import {
  type EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { linkText, type NoteLink, parseLinks } from "@shared/linked-notes/links";
import { isNoteTitle, NOTE_TITLE_MAX, titleFold } from "@shared/linked-notes/titles";
import { nameTier, queryWords } from "@shared/search/match";

/** A note the picker can offer (a live note of the campaign). */
export interface PickTitle {
  id: string;
  title: string;
}

// ---------- the revealed link (raw text while the caret is in it) ----------

export const setReveal = StateEffect.define<{ from: number; to: number } | null>();

export const revealField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setReveal)) return e.value;
    if (!value) return null;
    const from = tr.changes.mapPos(value.from, -1);
    const to = tr.changes.mapPos(value.to, 1);
    const head = tr.state.selection.main.head;
    // Until the caret leaves it (FR-NOTES-09).
    if (head < from || head > to) return null;
    return { from, to };
  },
});

/** The links of the text (a cache per document). */
const linkCache = new WeakMap<object, NoteLink[]>();
export function linksOf(state: EditorState): NoteLink[] {
  let list = linkCache.get(state.doc);
  if (!list) {
    list = parseLinks(state.doc.toString());
    linkCache.set(state.doc, list);
  }
  return list;
}

/** The links drawn as chips: all but the revealed one. */
export function chipsOf(state: EditorState): NoteLink[] {
  const r = state.field(revealField, false) ?? null;
  return linksOf(state).filter((l) => !(r && l.from === r.from && l.to === r.to));
}

type Target = { state: EditorState; dispatch(tr: Transaction): void };
const caretAt = (state: EditorState) => {
  const m = state.selection.main;
  return m.empty ? m.head : null;
};

/** FR-NOTES-09: Backspace just after a chip removes it whole. */
export function backspaceChip({ state, dispatch }: Target): boolean {
  const p = caretAt(state);
  if (p === null) return false;
  const chip = chipsOf(state).find((l) => l.to === p);
  if (!chip) return false;
  dispatch(state.update({ changes: { from: chip.from, to: chip.to }, userEvent: "delete" }));
  return true;
}

/** FR-NOTES-09: Delete just before a chip removes it whole. */
export function deleteChip({ state, dispatch }: Target): boolean {
  const p = caretAt(state);
  if (p === null) return false;
  const chip = chipsOf(state).find((l) => l.from === p);
  if (!chip) return false;
  dispatch(state.update({ changes: { from: chip.from, to: chip.to }, userEvent: "delete" }));
  return true;
}

/** FR-NOTES-09: arrowing into a chip shows its raw `[[…]]`, the caret inside the brackets. */
export function arrowIntoChip(dir: -1 | 1) {
  return ({ state, dispatch }: Target): boolean => {
    const p = caretAt(state);
    if (p === null) return false;
    const chip = chipsOf(state).find((l) => (dir < 0 ? l.to === p : l.from === p));
    if (!chip) return false;
    dispatch(
      state.update({
        effects: setReveal.of({ from: chip.from, to: chip.to }),
        selection: { anchor: dir < 0 ? chip.to - 2 : chip.from + 2 },
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

/** Alt+click (FR-NOTES-09): show this link's raw text, the caret inside it. */
export function revealAt(state: EditorState, link: NoteLink): TransactionSpec {
  return {
    effects: setReveal.of({ from: link.from, to: link.to }),
    selection: { anchor: link.to - 2 },
  };
}

// ---------- the title picker ----------

export interface Picker {
  /** Where its trigger (`@` or `[[`) starts. */
  from: number;
  trigger: "@" | "[[";
  /** The highlighted row. */
  index: number;
}

export const setPicker = StateEffect.define<Picker | null>();

/** `@` opens only at a line's start or after a space or punctuation (FR-NOTES-08). */
const OPENS_AT = /[\s\p{P}\p{S}]/u;

/** The picker's text after its trigger, or null when the picker must close. */
export function pickerQuery(state: EditorState, p: Picker): string | null {
  const sel: EditorSelection = state.selection;
  if (!sel.main.empty) return null;
  const head = sel.main.head;
  const start = p.from + p.trigger.length;
  if (head < start) return null;
  if (state.doc.sliceString(p.from, start) !== p.trigger) return null;
  const query = state.doc.sliceString(start, head);
  if (query.includes("\n") || query.length > NOTE_TITLE_MAX) return null;
  if (p.trigger === "@" && query.startsWith(" ")) return null; // a space right after `@`
  if (query.includes("]") || query.includes("[") || query.includes("|")) return null;
  return query;
}

/** Opens on a typed `@` (at a line start / after a space or punctuation) or a typed `[[`. */
function opened(tr: Transaction): Picker | null {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) return null;
  const { state } = tr;
  const m = state.selection.main;
  if (!m.empty) return null;
  const head = m.head;
  const ch = state.doc.sliceString(head - 1, head);
  if (ch === "@") {
    const line = state.doc.lineAt(head - 1);
    const before = head - 1 > line.from ? state.doc.sliceString(head - 2, head - 1) : "";
    if (before === "" || OPENS_AT.test(before)) return { from: head - 1, trigger: "@", index: 0 };
  }
  if (ch === "[" && state.doc.sliceString(head - 2, head) === "[[")
    return { from: head - 2, trigger: "[[", index: 0 };
  return null;
}

export const pickerField = StateField.define<Picker | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPicker)) return e.value;
    let next = value ? { ...value, from: tr.changes.mapPos(value.from, -1) } : null;
    if (next && pickerQuery(tr.state, next) === null) next = null;
    if (!next) next = opened(tr);
    if (next && value && tr.docChanged) next.index = 0;
    return next;
  },
});

/** A picker row: a note to link, or "Create note "…"" (always last, FR-NOTES-08). */
export type PickerRow =
  | { kind: "note"; id: string; title: string }
  | { kind: "create"; title: string };

/** At most this many notes, then the Create row. */
export const PICKER_NOTES_MAX = 8;

/** FR-NOTES-08: titles filtered with the shared matcher, best first; Create note last. */
export function pickerRows(query: string, titles: readonly PickTitle[]): PickerRow[] {
  const words = queryWords(query);
  const ranked =
    words.length === 0
      ? [...titles].sort((a, b) => a.title.localeCompare(b.title)).map((t) => ({ t, tier: 0 }))
      : titles
          .map((t) => ({ t, tier: nameTier(t.title, words) }))
          .filter((x): x is { t: PickTitle; tier: 0 | 1 | 2 | 3 } => x.tier !== null)
          .sort((a, b) => a.tier - b.tier || a.t.title.localeCompare(b.t.title));
  const rows: PickerRow[] = ranked
    .slice(0, PICKER_NOTES_MAX)
    .map(({ t }) => ({ kind: "note", id: t.id, title: t.title }));
  const clean = query.trim();
  if (isNoteTitle(clean)) rows.push({ kind: "create", title: clean });
  return rows;
}

/** The picker's text replaced by `[[Title]]`, the caret after it, the picker closed. */
export function pickInsert(state: EditorState, p: Picker, title: string): TransactionSpec {
  const head = state.selection.main.head;
  const insert = linkText(title);
  return {
    changes: { from: p.from, to: head, insert },
    selection: { anchor: p.from + insert.length },
    effects: setPicker.of(null),
    userEvent: "input.complete",
  };
}

/** The live note a link points to (by folded title), or null: a missing link. */
export function resolveLink(
  link: Pick<NoteLink, "fold">,
  byFold: ReadonlyMap<string, PickTitle>,
): PickTitle | null {
  return byFold.get(link.fold) ?? null;
}

/** Live titles by folded title. */
export function titlesByFold(titles: readonly PickTitle[]): Map<string, PickTitle> {
  return new Map(titles.map((t) => [titleFold(t.title), t]));
}
