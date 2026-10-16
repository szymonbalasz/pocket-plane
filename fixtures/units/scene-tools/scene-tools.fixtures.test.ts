import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { aoeTemplate, player, scene, sceneStructure } from "@server/db/schema";
import { asc } from "drizzle-orm";
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
  test("SCN §13 bundle `scene-tools` loads from empty: scn-templates on Goblin Ambush", async () => {
    const r = await loadBundle("scene-tools");
    dirs.push(r.dir);
    const db = r.openDb();
    const ambush = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush");
    const p1 = db
      .select()
      .from(player)
      .all()
      .find((p) => p.name === "Player 1");
    const templates = db.select().from(aoeTemplate).orderBy(asc(aoeTemplate.seq)).all();
    closeDb(db);
    expect(r.manifest.fixtures).toContain("scn-templates");
    // FR-FOG-10 (ADR-0042): both players see both templates on the revealed scene.
    expect(templates.map((x) => x.seenBy?.length)).toEqual([2, 2]);
    expect(
      templates.map(({ id, seq, createdAt, updatedAt, campaignId, seenBy, ...t }) => t),
    ).toEqual([
      {
        sceneId: ambush?.id as string,
        shape: "sphere",
        x: 3,
        y: 8,
        size: 15,
        width: null,
        angle: 0,
        label: "Spirit Guardians",
        placedByPlayerId: p1?.id as string,
        hidden: false,
        fogged: false,
      },
      {
        sceneId: ambush?.id as string,
        shape: "cube",
        x: 12,
        y: 12,
        size: 10,
        width: null,
        angle: 0,
        label: "Glyph",
        placedByPlayerId: null,
        hidden: true,
        fogged: false,
      },
    ]);
  });

  test("SCN §13 bundle `scene-tools` loads from empty: scn-walls on Goblin Ambush", async () => {
    const r = await loadBundle("scene-tools");
    dirs.push(r.dir);
    const db = r.openDb();
    const scenes = db.select().from(scene).all();
    const rows = db.select().from(sceneStructure).all();
    closeDb(db);
    expect(r.manifest.fixtures).toContain("scn-walls");
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
