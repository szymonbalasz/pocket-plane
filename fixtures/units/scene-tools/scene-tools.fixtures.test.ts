import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { scene, sceneStructure } from "@server/db/schema";
import { loadBundle } from "../../index";

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

describe("scene-tools fixtures (SCN §13)", () => {
  test("SCN §13 bundle `scene-tools` loads from empty: scn-walls on Goblin Ambush", async () => {
    const r = await loadBundle("scene-tools");
    dirs.push(r.dir);
    const db = r.openDb();
    const scenes = db.select().from(scene).all();
    const rows = db.select().from(sceneStructure).all();
    closeDb(db);
    expect(r.manifest.fixtures.at(-1)).toBe("scn-walls");
    const ambush = scenes.find((s) => s.name === "Goblin Ambush");
    expect(rows.map((s) => s.sceneId)).toEqual([ambush?.id as string]);
    expect(rows[0]).toMatchObject({
      rev: 3,
      nextN: 6,
      walls: [
        [1, 8, 0, 8, 5],
        [2, 8, 6, 8, 11],
        [3, 8, 12, 8, 14],
      ],
      doors: [
        [4, 8, 5, 8, 6, 1, 0],
        [5, 8, 11, 8, 12, 2, 0],
      ],
    });
  });
});
