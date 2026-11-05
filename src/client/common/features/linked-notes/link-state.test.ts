// NOTES N5 editor links, state side (no DOM): the `@` / `[[` picker opens and closes as FR-NOTES-08
// says, filters with the shared matcher with Create note last, and a pick inserts `[[Title]]`;
// chips: Backspace / Delete remove one whole, arrowing in shows the raw text until the caret
// leaves (FR-NOTES-09); a link resolves to the live note with its folded title (FR-NOTES-07).
import { describe, expect, test } from "bun:test";
import { EditorState, type Transaction } from "@codemirror/state";
import {
  arrowIntoChip,
  backspaceChip,
  chipsOf,
  deleteChip,
  type PickTitle,
  pickerField,
  pickerQuery,
  pickerRows,
  pickInsert,
  resolveLink,
  revealField,
  setPicker,
  titlesByFold,
} from "./link-state";

const NOTES: PickTitle[] = [
  { id: "n1", title: "Duke Varen" },
  { id: "n2", title: "Quest log" },
  { id: "n3", title: "Burnt Ledger" },
  { id: "n4", title: "Dungeon map" },
];

const make = (doc: string, at = doc.length) =>
  EditorState.create({ doc, selection: { anchor: at }, extensions: [pickerField, revealField] });

/** Types `text` at the caret, as a keystroke (`input.type`). */
function type(state: EditorState, text: string): EditorState {
  const at = state.selection.main.head;
  return state.update({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: "input.type",
  }).state;
}
const typeEach = (state: EditorState, text: string) => [...text].reduce(type, state);
const picker = (s: EditorState) => s.field(pickerField);
function run(
  state: EditorState,
  cmd: (t: { state: EditorState; dispatch(tr: Transaction): void }) => boolean,
) {
  let out = state;
  const ok = cmd({ state, dispatch: (tr) => (out = tr.state) });
  return { ok, state: out };
}

describe("linked-notes editor links (N5, state)", () => {
  test("FR-NOTES-08 `@` opens the picker at a line start, after a space or punctuation, not inside a word; `[[` opens it too", () => {
    expect(picker(type(make(""), "@"))).toMatchObject({ from: 0, trigger: "@" });
    expect(picker(type(make("Ask "), "@"))).toMatchObject({ from: 4, trigger: "@" });
    expect(picker(type(make("Ask (", 5), "@"))).toMatchObject({ from: 5 });
    expect(picker(type(make("line one\n"), "@"))).toMatchObject({ from: 9 });
    expect(picker(type(make("mail"), "@"))).toBeNull();
    expect(picker(typeEach(make("See "), "[["))).toMatchObject({ from: 4, trigger: "[[" });
    // Pasted text never opens it.
    const pasted = make("").update({ changes: { from: 0, insert: "@" }, userEvent: "input.paste" });
    expect(picker(pasted.state)).toBeNull();
  });

  test("FR-NOTES-08 the query follows typing; a space right after `@`, Esc, or moving the caret away closes it, the text stays", () => {
    let s = typeEach(make("Ask "), "@Du");
    const p = picker(s);
    expect(p && pickerQuery(s, p)).toBe("Du");
    s = typeEach(s, "ke V");
    expect(pickerQuery(s, picker(s) as never)).toBe("Duke V");
    // Esc.
    const esc = s.update({ effects: setPicker.of(null) }).state;
    expect(picker(esc)).toBeNull();
    expect(esc.doc.toString()).toBe("Ask @Duke V");
    // A space right after `@`.
    expect(picker(typeEach(make("Ask "), "@ "))).toBeNull();
    // The caret moved away (before the `@`).
    const moved = s.update({ selection: { anchor: 1 } }).state;
    expect(picker(moved)).toBeNull();
    // `@Nobody` then Esc: plain text, no link.
    const nobody = typeEach(make(""), "@Nobody").update({ effects: setPicker.of(null) }).state;
    expect(nobody.doc.toString()).toBe("@Nobody");
    expect(chipsOf(nobody)).toEqual([]);
  });

  test("FR-NOTES-08 rows: titles filtered with the shared matcher, best first, at most 8; Create note last", () => {
    expect(pickerRows("Du", NOTES)).toEqual([
      { kind: "note", id: "n1", title: "Duke Varen" },
      { kind: "note", id: "n4", title: "Dungeon map" },
      { kind: "create", title: "Du" },
    ]);
    expect(pickerRows("varen", NOTES)[0]).toEqual({ kind: "note", id: "n1", title: "Duke Varen" });
    expect(pickerRows("Zzz", NOTES)).toEqual([{ kind: "create", title: "Zzz" }]);
    expect(pickerRows("", NOTES).map((r) => r.kind)).toEqual(["note", "note", "note", "note"]);
    const many = Array.from({ length: 12 }, (_x, i) => ({ id: `m${i}`, title: `Map ${i}` }));
    expect(pickerRows("map", many).filter((r) => r.kind === "note")).toHaveLength(8);
  });

  test("FR-NOTES-08 a pick replaces `@…` (or `[[…`) with `[[Title]]`, caret after it, picker closed", () => {
    const s = typeEach(make("Ask "), "@Du");
    const done = s.update(pickInsert(s, picker(s) as never, "Duke Varen")).state;
    expect(done.doc.toString()).toBe("Ask [[Duke Varen]]");
    expect(done.selection.main.head).toBe("Ask [[Duke Varen]]".length);
    expect(picker(done)).toBeNull();
    const b = typeEach(make("See "), "[[que");
    const done2 = b.update(pickInsert(b, picker(b) as never, "Quest log")).state;
    expect(done2.doc.toString()).toBe("See [[Quest log]]");
  });

  test("FR-NOTES-09 Backspace just after a chip and Delete just before it remove it whole", () => {
    const doc = "See [[Duke Varen]] now";
    const after = run(make(doc, 18), backspaceChip);
    expect(after.ok).toBe(true);
    expect(after.state.doc.toString()).toBe("See  now");
    const before = run(make(doc, 4), deleteChip);
    expect(before.state.doc.toString()).toBe("See  now");
    // Elsewhere they do nothing (the default key handles it).
    expect(run(make(doc, 3), backspaceChip).ok).toBe(false);
  });

  test("FR-NOTES-09 arrowing into a chip shows its raw text, caret inside, until the caret leaves", () => {
    const doc = "See [[Duke Varen]] now";
    const left = run(make(doc, 18), arrowIntoChip(-1)).state;
    expect(left.field(revealField)).toEqual({ from: 4, to: 18 });
    expect(left.selection.main.head).toBe(16);
    expect(chipsOf(left)).toEqual([]); // shown as text, editable
    // Typing inside keeps it revealed; leaving hides it again.
    const edited = type(left, "!");
    expect(edited.field(revealField)).toEqual({ from: 4, to: 19 });
    const gone = edited.update({ selection: { anchor: 0 } }).state;
    expect(gone.field(revealField)).toBeNull();
    expect(chipsOf(gone).map((l) => l.target)).toEqual(["Duke Varen!"]);
    const right = run(make(doc, 4), arrowIntoChip(1)).state;
    expect(right.selection.main.head).toBe(6);
  });

  test("FR-NOTES-07 FR-NOTES-10 a link resolves to the live note with its folded title; none → missing", () => {
    const byFold = titlesByFold(NOTES);
    expect(resolveLink({ fold: "duke varen" }, byFold)).toEqual(NOTES[0] as PickTitle);
    expect(resolveLink({ fold: "nobody" }, byFold)).toBeNull();
  });
});
