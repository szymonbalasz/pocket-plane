// NOTES N9 (FR-NOTES-29): bundle `notes-token` from empty: Town active with player-1's Mira
// (character token), a visible NPC also named "Mira" and a hidden "Shadow".
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { scene, token } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { NOTES_TOKENS } from "./notes-tokens";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

describe("fixtures: notes-token bundle (N9)", () => {
  test("FR-NOTES-29 `notes-token` from empty: a PC and an NPC named Mira on the active Town, a hidden Shadow", async () => {
    const r = await loadBundle("notes-token", { cache: false });
    dirs.push(r.dir);
    const db = r.openDb();
    const town = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Town");
    expect(town?.active).toBe(true);
    const rows = db
      .select()
      .from(token)
      .orderBy(asc(token.seq))
      .all()
      .filter((t) => t.sceneId === town?.id)
      .map((t) => ({
        name: t.name,
        pc: t.characterId !== null,
        hidden: t.hidden,
        at: [t.col, t.row],
      }));
    expect(rows).toEqual([
      { name: "Mira", pc: true, hidden: false, at: [5, 5] },
      {
        name: NOTES_TOKENS.npcMira.name,
        pc: false,
        hidden: false,
        at: [NOTES_TOKENS.npcMira.col, NOTES_TOKENS.npcMira.row],
      },
      {
        name: NOTES_TOKENS.hidden.name,
        pc: false,
        hidden: true,
        at: [NOTES_TOKENS.hidden.col, NOTES_TOKENS.hidden.row],
      },
    ]);
  });
});
