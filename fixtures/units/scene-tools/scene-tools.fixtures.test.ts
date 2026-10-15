import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { aoeTemplate, player, scene } from "@server/db/schema";
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
    expect(templates.map(({ id, seq, createdAt, updatedAt, campaignId, ...t }) => t)).toEqual([
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
});
