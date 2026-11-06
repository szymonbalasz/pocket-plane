// NOTES N8 client logic (FR-NOTES-25 – -27): the category fold-outs (order, counts, A–Z, empty
// groups hidden), the Recent list, the per-browser sort and fold-out states (Session open at
// first), and the editor's category step (opens after Create note or a missing chip, keyboard
// moves, closes when the person moves on, survives others' typing).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { NOTE_CATEGORIES, type NoteRecord } from "@shared/linked-notes/schemas";
import { categoryField, pickerField, setCategoryAsk, setPicker } from "./link-state";
import { groupNotes, recentNotes } from "./logic";
import {
  GROUPS_KEY,
  groupOpen,
  parseGroups,
  readGroupsRaw,
  readSort,
  resetNotesPrefsForTests,
  SORT_KEY,
  writeGroupOpen,
  writeSort,
} from "./prefs";

const note = (id: string, over: Partial<NoteRecord> = {}): NoteRecord => ({
  id,
  campaignId: "c1",
  title: id,
  category: "other",
  createdBy: { role: "dm", playerId: null },
  updatedAt: "2026-11-05T10:00:00.000Z",
  updatedBy: { role: "dm", playerId: null },
  deletedAt: null,
  deletedBy: null,
  ...over,
});

const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  resetNotesPrefsForTests();
});
afterEach(() => {
  if (real) Object.defineProperty(globalThis, "localStorage", real);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  resetNotesPrefsForTests();
});

describe("linked-notes categories, client (N8)", () => {
  test("FR-NOTES-26 fold-outs in the fixed order with counts, A–Z inside, empty groups and binned notes left out", () => {
    const rows = [
      note("q", { title: "Quest log", category: "quest" }),
      note("b", { title: "burnt Ledger", category: "item" }),
      note("a", { title: "Amulet", category: "item" }),
      note("s10", { title: "Session 10", category: "session" }),
      note("s2", { title: "Session 2", category: "session" }),
      note("d", { title: "Duke Varen", category: "npc" }),
      note("x", {
        title: "Old rumours",
        category: "faction",
        deletedAt: "2026-11-01T00:00:00.000Z",
        deletedBy: { role: "dm", playerId: null },
      }),
    ];
    const groups = groupNotes(rows);
    expect(groups.map((g) => [g.category, g.notes.map((n) => n.title)])).toEqual([
      ["session", ["Session 2", "Session 10"]],
      ["npc", ["Duke Varen"]],
      ["quest", ["Quest log"]],
      ["item", ["Amulet", "burnt Ledger"]],
    ]);
    expect(NOTE_CATEGORIES[0]).toBe("session");
    expect(groupNotes([])).toEqual([]);
  });

  test("FR-NOTES-27 Recent: one flat list, last edited first, binned left out", () => {
    const rows = [
      note("a", { title: "Amulet", category: "item", updatedAt: "2026-11-05T09:00:00.000Z" }),
      note("q", { title: "Quest log", category: "quest", updatedAt: "2026-11-05T12:00:00.000Z" }),
      note("d", { title: "Duke Varen", category: "npc", updatedAt: "2026-11-05T11:00:00.000Z" }),
      note("x", { deletedAt: "2026-11-06T00:00:00.000Z" }),
    ];
    expect(recentNotes(rows).map((n) => n.title)).toEqual(["Quest log", "Duke Varen", "Amulet"]);
  });

  test("FR-NOTES-27 the sort is remembered per browser; category view by default", () => {
    expect(readSort()).toBe("category");
    writeSort("recent");
    expect(store.get(SORT_KEY)).toBe("recent");
    resetNotesPrefsForTests();
    expect(readSort()).toBe("recent");
    store.set(SORT_KEY, "nonsense");
    expect(readSort()).toBe("category");
  });

  test("FR-NOTES-26 Session starts open, the others closed; each opens or closes as last left, per browser", () => {
    const now = () => parseGroups(readGroupsRaw());
    expect(groupOpen(now(), "session")).toBe(true);
    for (const c of NOTE_CATEGORIES.filter((c) => c !== "session"))
      expect([c, groupOpen(now(), c)]).toEqual([c, false]);
    writeGroupOpen("npc", true);
    writeGroupOpen("session", false);
    expect(JSON.parse(store.get(GROUPS_KEY) ?? "{}")).toEqual({ npc: true, session: false });
    resetNotesPrefsForTests();
    expect(groupOpen(now(), "npc")).toBe(true);
    expect(groupOpen(now(), "session")).toBe(false);
    expect(parseGroups("not json")).toEqual({});
    expect(parseGroups('{"npc": "yes", "item": true}')).toEqual({ item: true });
  });

  test("FR-NOTES-26 FR-NOTES-27 storage that throws: the defaults, then the choice for this page", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(readSort()).toBe("category");
    writeSort("recent");
    expect(readSort()).toBe("recent");
    writeGroupOpen("item", true);
    expect(groupOpen(parseGroups(readGroupsRaw()), "item")).toBe(true);
  });

  test("FR-NOTES-25 the category step: opens on request, closes when the person types, moves or the picker goes; others' typing only shifts it", () => {
    let state = EditorState.create({
      doc: "See @Har",
      selection: { anchor: 8 },
      extensions: [pickerField, categoryField],
    });
    state = state.update({ effects: setPicker.of({ from: 4, trigger: "@", index: 0 }) }).state;
    state = state.update({
      effects: setCategoryAsk.of({ title: "Har", pos: 8, after: "link", index: 0 }),
    }).state;
    expect(state.field(categoryField)).toMatchObject({ title: "Har", index: 0 });
    // Someone else types at the start: the step stays, shifted.
    state = state.update({ changes: { from: 0, insert: "Hi. " } }).state;
    expect(state.field(categoryField)?.pos).toBe(12);
    // Our own typing ends it.
    const typed = state.update({
      changes: { from: 12, insert: "b" },
      selection: { anchor: 13 },
      userEvent: "input.type",
    }).state;
    expect(typed.field(categoryField)).toBeNull();
    // So does moving the caret, and the picker closing (link mode).
    expect(
      state
        .update({ selection: { anchor: 0 }, userEvent: "select.pointer" })
        .state.field(categoryField),
    ).toBeNull();
    expect(state.update({ effects: setPicker.of(null) }).state.field(categoryField)).toBeNull();
    // Open mode (a missing chip) doesn't need the picker.
    let chip = EditorState.create({ doc: "[[Harbour]]", extensions: [pickerField, categoryField] });
    chip = chip.update({
      effects: setCategoryAsk.of({ title: "Harbour", pos: 0, after: "open", index: 3 }),
    }).state;
    expect(chip.field(categoryField)).toMatchObject({ after: "open", index: 3 });
  });
});
