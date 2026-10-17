import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { aoeTemplate, player, scene, token } from "@server/db/schema";
import { templateCells } from "@shared/scene-tools/geometry";
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

describe("map-tools fixtures (SCN / MAP §13, sprint 4)", () => {
  test("SCN §13 bundle `map-tools` loads from empty: vision + scn-templates + mt-templates + mt-crowd", async () => {
    const r = await loadBundle("map-tools");
    dirs.push(r.dir);
    const db = r.openDb();
    const scenes = db.select().from(scene).all();
    const players = db.select().from(player).all();
    const templates = db.select().from(aoeTemplate).orderBy(asc(aoeTemplate.seq)).all();
    const tokens = db.select().from(token).orderBy(asc(token.seq)).all();
    closeDb(db);
    const ambush = scenes.find((s) => s.name === "Goblin Ambush");
    const town = scenes.find((s) => s.name === "Town");
    const p2 = players.find((p) => p.name === "Player 2");
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining(["vision-crypt", "scn-templates", "mt-templates", "mt-crowd"]),
    );
    // MAP §13: Goblin Ambush inactive at load (Town live), so step M1 shows it.
    expect(town?.active).toBe(true);
    expect(ambush?.active).toBe(false);
    expect(templates.map((t) => t.label)).toEqual([
      "Spirit Guardians",
      "Glyph",
      "Thunderwave",
      "Web",
    ]);
    const [, , thunderwave, web] = templates;
    expect(thunderwave).toMatchObject({
      sceneId: ambush?.id,
      shape: "cube",
      x: 1.5,
      y: 10.5,
      size: 15,
      angle: 300,
      placedByPlayerId: p2?.id,
      hidden: false,
      fogged: false,
    });
    expect(web).toMatchObject({
      sceneId: ambush?.id,
      shape: "cube",
      x: 0,
      y: 6,
      size: 20,
      angle: 0,
      placedByPlayerId: null,
      hidden: false,
      fogged: false,
    });
    // Web is mostly inside the revealed nook: both players see it (FR-SCN-35, ADR-0042).
    expect(web?.seenBy?.length).toBe(2);
    // FR-SCN-41 golden: Thunderwave = 8 squares (the old centre rule gave 10).
    const map = ambush as NonNullable<typeof ambush>;
    const rect = {
      gridCellSize: map.gridCellSize,
      gridOffsetX: map.gridOffsetX,
      gridOffsetY: map.gridOffsetY,
      mapWidth: map.mapWidth as number,
      mapHeight: map.mapHeight as number,
    };
    expect(
      templateCells(thunderwave as NonNullable<typeof thunderwave>, rect, { cut: true }),
    ).toEqual([
      [3, 8],
      [2, 9],
      [3, 9],
      [4, 9],
      [2, 10],
      [3, 10],
      [4, 10],
      [3, 11],
    ]);
    // MAP §13 `mt-crowd`: visible, numbered, inside both players' sight.
    const crowd = tokens.filter((t) =>
      ["Goblin Sneak", "Goblin Sneak 2", "Crypt Ogre"].includes(t.name),
    );
    expect(crowd.map((t) => [t.name, t.col, t.row, t.size, t.hidden, t.sceneId])).toEqual([
      ["Goblin Sneak", 4, 9, "small", false, ambush?.id],
      ["Goblin Sneak 2", 5, 9, "small", false, ambush?.id],
      ["Crypt Ogre", 4, 10, "large", false, ambush?.id],
    ]);
    expect(crowd.map((t) => t.seenBy?.length)).toEqual([2, 2, 2]);
  });
});
