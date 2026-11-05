// NOTES build §1.2 unit: title validity and folding (FR-NOTES-02), the "(restored)" names
// shortened to 100 characters (FR-NOTES-05), the intent schemas' title rule.
import { describe, expect, test } from "bun:test";
import { CreateNoteIntent, RenameNoteIntent } from "./schemas";
import { isNoteTitle, NOTE_TITLE_MAX, restoredTitle, titleFold, titleLength } from "./titles";

const takenOf = (titles: string[]) => {
  const keys = new Set(titles.map(titleFold));
  return (key: string) => keys.has(key);
};

describe("linked-notes titles", () => {
  test("FR-NOTES-02 a title is 1–100 characters with no [[, ]], | or line break", () => {
    for (const ok of ["Quest log", "A", "Duke Varen's office", "[Map] (old)", "x".repeat(100)])
      expect([ok, isNoteTitle(ok)]).toEqual([ok, true]);
    for (const bad of [
      "",
      "x".repeat(101),
      "See [[Duke",
      "Duke]] Varen",
      "a|b",
      "two\nlines",
      "cr\rhere",
      `sep${String.fromCharCode(0x2028)}x`,
      `para${String.fromCharCode(0x2029)}x`,
    ])
      expect([bad, isNoteTitle(bad)]).toEqual([bad, false]);
    // Code points: 100 emoji are 100 characters.
    expect(isNoteTitle("🐉".repeat(100))).toBe(true);
    expect(isNoteTitle("🐉".repeat(101))).toBe(false);
  });

  test("FR-NOTES-02 the intents trim the title, then apply the rule", () => {
    expect(CreateNoteIntent.parse({ title: "  Quest log  " }).title).toBe("Quest log");
    expect(CreateNoteIntent.safeParse({ title: "   " }).success).toBe(false);
    expect(CreateNoteIntent.safeParse({ title: ` ${"x".repeat(100)} ` }).success).toBe(true);
    expect(RenameNoteIntent.safeParse({ noteId: "n1", title: "a|b" }).success).toBe(false);
    expect(CreateNoteIntent.safeParse({ title: "Ok", extra: 1 }).success).toBe(false);
  });

  test("FR-NOTES-02 titles compare folded with the shared matcher's fold", () => {
    expect(titleFold("Quest Log")).toBe(titleFold("quest log"));
    expect(titleFold("Quest-log")).toBe(titleFold("QUEST  LOG"));
    expect(titleFold("Hunter's Mark")).toBe(titleFold("hunters mark"));
    expect(titleFold("Café")).toBe(titleFold("cafe"));
    expect(titleFold("Quest log")).not.toBe(titleFold("Quest logs"));
  });

  test("FR-NOTES-05 restore keeps a free title, else (restored), (restored 2)… folded", () => {
    expect(restoredTitle("Old rumours", takenOf([]))).toBe("Old rumours");
    expect(restoredTitle("Old rumours", takenOf(["old RUMOURS"]))).toBe("Old rumours (restored)");
    expect(restoredTitle("Old rumours", takenOf(["Old rumours", "Old rumours (restored)"]))).toBe(
      "Old rumours (restored 2)",
    );
    expect(
      restoredTitle(
        "Old rumours",
        takenOf(["Old rumours", "old rumours restored", "Old rumours (restored 2)"]),
      ),
    ).toBe("Old rumours (restored 3)");
  });

  test("FR-NOTES-05 a restored name is cut to stay within 100 characters, never splitting a character", () => {
    const long = `${"a".repeat(95)} tail`; // 100 characters
    const one = restoredTitle(long, takenOf([long]));
    expect(titleLength(one)).toBeLessThanOrEqual(NOTE_TITLE_MAX);
    expect(one.endsWith(" (restored)")).toBe(true);
    expect(isNoteTitle(one)).toBe(true);
    expect(one).toBe(`${"a".repeat(89)} (restored)`);
    const two = restoredTitle(long, takenOf([long, one]));
    expect(two).toBe(`${"a".repeat(87)} (restored 2)`);
    expect(titleLength(two)).toBe(100);
    const dragons = "🐉".repeat(100);
    const d = restoredTitle(dragons, takenOf([dragons]));
    expect(d).toBe(`${"🐉".repeat(89)} (restored)`);
    expect(titleLength(d)).toBe(100);
  });
});
