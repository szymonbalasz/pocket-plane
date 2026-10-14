import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { seededContext } from "@server/commands/context";
import { closeDb } from "@server/db/client";
import { player, scene, sceneFolder, token } from "@server/db/schema";
import { resolveBundle } from "@server/features/fixtures-adapters/loader";
import { asc } from "drizzle-orm";
import { library, loadBundle } from "../../index";

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

async function loaded(bundle: string) {
  const r = await loadBundle(bundle);
  dirs.push(r.dir);
  const db = r.openDb();
  const scenes = db.select().from(scene).orderBy(asc(scene.seq)).all();
  const folders = db.select().from(sceneFolder).all();
  const tokens = db.select().from(token).orderBy(asc(token.seq)).all();
  closeDb(db);
  return { ...r, scenes, folders, tokens };
}

let first: Awaited<ReturnType<typeof loaded>> | null = null;

describe("scenes-map fixtures (MAP §13)", () => {
  test("bundle `scenes` loads from empty: Town (active), Goblin Ambush, Cellar, Act 1", async () => {
    const r = await loaded("scenes");
    first = r;
    const by = (n: string) => r.scenes.find((s) => s.name === n);
    const act1 = r.folders.find((f) => f.name === "Act 1");
    expect(r.folders).toHaveLength(1);
    expect(by("Town")).toMatchObject({
      active: true,
      folderId: act1?.id,
      mapWidth: 1400,
      mapHeight: 980,
      gridCellSize: 70,
    });
    expect(by("Goblin Ambush")).toMatchObject({
      active: false,
      folderId: act1?.id,
      mapWidth: 1400,
    });
    expect(by("Cellar")).toMatchObject({
      active: false,
      folderId: null,
      mapLocked: true,
      mapWidth: 4096,
      gridCellSize: 50,
      gridOffsetX: 25,
      gridOffsetY: 10,
      gridColor: "#ffffff",
      gridOpacity: 0.3,
    });
    const on = (n: string) =>
      r.tokens
        .filter((t) => t.sceneId === by(n)?.id)
        .map((t) => [t.name, t.col, t.row, t.size, t.hidden]);
    expect(on("Town")).toEqual([
      ["Mira", 5, 5, "medium", false],
      ["Thorn", 4, 5, "medium", false],
    ]);
    expect(on("Goblin Ambush")).toEqual([
      ["Mira", 2, 7, "medium", false],
      ["Goblin", 12, 6, "small", false],
      ["Wolf", 14, 4, "medium", true],
      ["Elite Goblin Warrior", 15, 8, "small", true],
      ["Thorn", 2, 9, "medium", false],
      ["Cave Ogre", 9, 10, "large", false],
    ]);
    expect(on("Cellar")).toEqual([["Goblin", 40, 27, "small", false]]);
    // FR-MAP-35 / -36: shapes from the definitions' tokenShape (Cave Ogre none, Elite square).
    expect(r.tokens.find((t) => t.name === "Cave Ogre")).toMatchObject({
      speed: 40,
      shape: "none",
    });
    expect(r.tokens.filter((t) => t.shape !== "round").map((t) => t.name)).toEqual([
      "Elite Goblin Warrior",
      "Cave Ogre",
    ]);
    const mira = r.tokens.find((t) => t.name === "Mira");
    expect(mira?.imageAssetId).toBe(r.manifest.records.images?.asset?.[2] as string);
    expect(mira?.ownerPlayerId).not.toBeNull();
    expect(r.tokens.find((t) => t.name === "Thorn")?.ownerPlayerId).not.toBe(mira?.ownerPlayerId);
  });

  test("FR-FIX-08 seeded IDs per fixture key; session-sim includes town + battlemap", async () => {
    const a = first ?? (await loaded("scenes"));
    // IDs come from the per-key seeded context: the first scene of `town` is the key's first ID.
    const expected = seededContext({ disposable: true, key: "town" }).ids.next();
    expect(a.manifest.records.town?.scene).toEqual([expected]);
    const keys = resolveBundle(library, "session-sim").map((f) => f.key);
    expect(keys).toContain("town");
    expect(keys).toContain("battlemap");
    expect(keys).not.toContain("scenes-extras");
  });

  test("G1 thorn-town: session-sim puts Thorn (player-2) on Town (4, 5) and Goblin Ambush (2, 9)", async () => {
    const r = await loaded("session-sim");
    const keys = resolveBundle(library, "session-sim").map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["thorn-town", "thorn-battlemap"]));
    const db = r.openDb();
    const p2 = db
      .select()
      .from(player)
      .all()
      .find((p) => p.name === "Player 2");
    closeDb(db);
    const by = (n: string) => r.scenes.find((s) => s.name === n)?.id ?? null;
    const thorns = r.tokens
      .filter((t) => t.name === "Thorn")
      .map((t) => [t.sceneId, t.col, t.row, t.hidden, t.ownerPlayerId]);
    expect(thorns).toEqual([
      [by("Town"), 4, 5, false, p2?.id ?? null],
      [by("Goblin Ambush"), 2, 9, false, p2?.id ?? null],
    ]);
    // G11: both carry `token-thorn` (images index 6).
    const thornArt = r.manifest.records.images?.asset?.[6] ?? null;
    expect(thornArt).toBeString();
    expect(r.tokens.filter((t) => t.name === "Thorn").map((t) => t.imageAssetId)).toEqual([
      thornArt,
      thornArt,
    ]);
    // `scenes` keeps its own placements: Thorn once on Town.
    const s = first ?? (await loaded("scenes"));
    const town = s.scenes.find((x) => x.name === "Town")?.id;
    expect(s.tokens.filter((t) => t.name === "Thorn" && t.sceneId === town)).toHaveLength(1);
  });
});
