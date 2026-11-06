import { describe, expect, test } from "bun:test";
import {
  CREATE_SENDS_CATEGORY,
  tokenNoteAction,
  tokenNoteCategory,
  tokenNoteCreate,
  tokenNoteMatch,
  tokenNoteTitle,
} from "./token-note";

const note = (id: string, title: string, deletedAt: string | null = null) => ({
  id,
  title,
  deletedAt,
});

describe("FR-NOTES-29 token note title", () => {
  test("FR-NOTES-29 keeps a plain name, trimmed", () => {
    expect(tokenNoteTitle("Goblin Boss")).toBe("Goblin Boss");
    expect(tokenNoteTitle("  Mira  ")).toBe("Mira");
  });

  test("FR-NOTES-29 strips [[, ]] and |, then trims", () => {
    expect(tokenNoteTitle("[[Duke Varen]]")).toBe("Duke Varen");
    expect(tokenNoteTitle("Mira | scout")).toBe("Mira  scout");
    expect(tokenNoteTitle(" [[ Ogre ]] ")).toBe("Ogre");
    // A strip that leaves a new mark is stripped again.
    expect(tokenNoteTitle("a[|[b")).toBe("ab");
    expect(tokenNoteTitle("x]|]y")).toBe("xy");
    // A lone bracket is a valid title character.
    expect(tokenNoteTitle("[Wolf]")).toBe("[Wolf]");
  });

  test("FR-NOTES-29 no valid title left → no entry", () => {
    expect(tokenNoteTitle("")).toBeNull();
    expect(tokenNoteTitle("   ")).toBeNull();
    expect(tokenNoteTitle("[[]]")).toBeNull();
    expect(tokenNoteTitle("| [[ ]] |")).toBeNull();
    expect(tokenNoteTitle("x".repeat(101))).toBeNull();
    expect(tokenNoteTitle("x".repeat(100))).toBe("x".repeat(100));
  });
});

describe("FR-NOTES-29 token note category", () => {
  test("FR-NOTES-29 Player for a character token, NPC for any other", () => {
    expect(tokenNoteCategory({ characterId: "char-mira" })).toBe("player");
    expect(tokenNoteCategory({ characterId: null })).toBe("npc");
  });

  test("FR-NOTES-29 create payload: ifMissing, the category once N8 is in", () => {
    const p = tokenNoteCreate({ characterId: "c1" }, "Mira");
    expect(p).toMatchObject({ title: "Mira", ifMissing: true });
    expect(p.category).toBe(CREATE_SENDS_CATEGORY ? "player" : undefined);
  });
});

describe("FR-NOTES-29 token note match", () => {
  test("FR-NOTES-29 a live note with the folded title matches", () => {
    const notes = [note("n1", "Quest log"), note("n2", "goblin  BOSS")];
    expect(tokenNoteMatch("Goblin Boss", notes)).toBe("n2");
    expect(tokenNoteMatch("Gòblin-Boss", notes)).toBe("n2");
    expect(tokenNoteMatch("Goblin", notes)).toBeNull();
  });

  test("FR-NOTES-29 a binned note doesn't match", () => {
    const notes = [note("n1", "Mira", "2026-11-06T00:00:00.000Z")];
    expect(tokenNoteMatch("Mira", notes)).toBeNull();
    expect(tokenNoteMatch("Mira", [...notes, note("n2", "mira")])).toBe("n2");
  });
});

describe("FR-NOTES-29 token note action", () => {
  test("FR-NOTES-29 match → Open; none → Create; none on a hidden token → ask first", () => {
    expect(tokenNoteAction({ hidden: false }, "n1")).toBe("open");
    expect(tokenNoteAction({ hidden: true }, "n1")).toBe("open");
    expect(tokenNoteAction({ hidden: false }, null)).toBe("create");
    expect(tokenNoteAction({ hidden: true }, null)).toBe("confirm");
  });
});
