// NOTES N5 r1, the editor's decorations without a DOM: live preview (markers hidden off the caret
// line, shown on it; bullets for `-` lists, numbers kept), chips (missing ones flagged), die buttons
// after dice notation, and the hover hints' texts (FR-NOTES-07, -09, -10, -13).
import { describe, expect, test } from "bun:test";
import { redo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { revealField, titlesByFold } from "./link-state";
import {
  buildDecorations,
  CHIP_HINT,
  caretLines,
  dieHint,
  focusField,
  type LinkHost,
  listLevel,
  MISSING_HINT,
} from "./link-view";
import { REDO_KEYS } from "./NoteEditor";

const NOTES = [{ id: "n1", title: "Duke Varen" }];
const host: LinkHost = {
  titles: () => NOTES,
  byFold: () => titlesByFold(NOTES),
  follow: () => {},
  create: async () => true,
  roll: () => {},
};

interface Seen {
  from: number;
  to: number;
  kind: string;
}
function decorations(doc: string, caret: number): Seen[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [revealField],
  });
  const out: Seen[] = [];
  buildDecorations(state, host).between(0, doc.length, (from, to, d: Decoration) => {
    const spec = d.spec as {
      class?: string;
      widget?: { constructor: { name: string }; missing?: boolean };
    };
    const kind = spec.widget
      ? `${spec.widget.constructor.name}${spec.widget.missing ? ":missing" : ""}`
      : (spec.class ?? (from === to ? "point" : "hide"));
    out.push({ from, to, kind });
  });
  return out;
}
const kinds = (list: Seen[]) => list.map((s) => `${s.kind}@${s.from}-${s.to}`);

describe("linked-notes editor decorations (N5 r1)", () => {
  test("FR-NOTES-13 r1 live preview: off the caret's line `#` and `**` hide; on it they show to edit", () => {
    const doc = "# Quest log\nFind **the** ledger";
    const away = kinds(decorations(doc, doc.length)); // caret on line 2
    expect(away).toContain("cm-note-h cm-note-h1@0-0");
    expect(away).toContain("hide@0-2"); // "# " hidden on line 1
    const here = kinds(decorations(doc, 3)); // caret on line 1
    expect(here).toContain("cm-note-md@0-1"); // "#" shown, muted
    expect(here).not.toContain("hide@0-2");
    // Bold on line 2: hidden markers away from it, shown on it.
    expect(kinds(decorations(doc, 0))).toEqual(
      expect.arrayContaining(["hide@17-19", "cm-note-bold@19-22", "hide@22-24"]),
    );
    expect(away).toEqual(expect.arrayContaining(["cm-note-md@17-19", "cm-note-md@22-24"]));
  });

  test("FR-NOTES-13 r1 lists: `-` and `*` become a bullet with an indent off the caret's line; numbers stay", () => {
    const doc = "- first\n* second\n1. third\nend";
    const away = kinds(decorations(doc, doc.length));
    expect(away).toEqual(
      expect.arrayContaining([
        "cm-note-li cm-note-li-0@0-0",
        "Bullet@0-2",
        "cm-note-li cm-note-li-0@8-8",
        "Bullet@8-10",
        "cm-note-li cm-note-li-0@17-17",
        "cm-note-li-mark@17-20",
      ]),
    );
    const onFirst = kinds(decorations(doc, 3));
    expect(onFirst).toContain("cm-note-li-mark@0-2");
    expect(onFirst).not.toContain("Bullet@0-2");
  });

  test("FR-NOTES-13 r1 nested lists indent one step per level; off the caret's line the indent is padding", () => {
    expect([
      listLevel(""),
      listLevel("  "),
      listLevel("\t"),
      listLevel("    "),
      listLevel("\t\t\t\t\t"),
    ]).toEqual([0, 1, 1, 2, 4]);
    const doc = "- top\n  - nested\n    - deeper\nend";
    const away = kinds(decorations(doc, doc.length));
    expect(away).toEqual(
      expect.arrayContaining([
        "cm-note-li cm-note-li-1@6-6",
        "hide@6-8",
        "Bullet@8-10",
        "cm-note-li cm-note-li-2@17-17",
        "hide@17-21",
      ]),
    );
  });

  test("FR-NOTES-13 r1 an editor without focus previews every line (an opened note's line-1 heading is styled)", () => {
    const doc = "# Quest log\nmore";
    const state = (focused: boolean) =>
      EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [revealField, focusField.init(() => focused)],
      });
    expect(caretLines(state(false)).size).toBe(0);
    expect(caretLines(state(true))).toEqual(new Set([1]));
    const seen: string[] = [];
    buildDecorations(state(false), host).between(0, doc.length, (from, to, d) => {
      if (!(d.spec as { class?: string }).class && from !== to) seen.push(`hide@${from}-${to}`);
    });
    expect(seen).toContain("hide@0-2");
  });

  test("FR-NOTES-17 r1 Ctrl+Shift+Z / Cmd+Shift+Z redo on every platform", () => {
    expect(REDO_KEYS.map((k) => k.key)).toEqual(["Mod-Shift-z"]);
    expect(REDO_KEYS[0]?.run).toBe(redo);
  });

  test("FR-NOTES-07 FR-NOTES-10 FR-NOTES-13 chips (a missing one flagged) and a die after dice notation", () => {
    const doc = "Ask [[Duke Varen]] and [[Lost tomb]], roll 2d6.";
    const all = kinds(decorations(doc, 0));
    expect(all).toContain("Chip@4-18");
    expect(all).toContain("Chip:missing@23-36");
    expect(all).toContain("Die@46-46");
    expect([CHIP_HINT, MISSING_HINT, dieHint("2d6")]).toEqual([
      "Open · Alt+click to edit",
      "No note yet · click to create",
      "Roll 2d6",
    ]);
  });
});
