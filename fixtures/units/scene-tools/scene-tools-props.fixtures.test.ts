import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { asset, prop, scene } from "@server/db/schema";
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

describe("scene-tools prop fixtures (SCN §13)", () => {
  test("SCN §13 bundle `scene-tools-props` loads from empty: barrel, rotated table, hidden chest on Goblin Ambush; same IDs twice", async () => {
    const load = async () => {
      const r = await loadBundle("scene-tools-props");
      dirs.push(r.dir);
      const db = r.openDb();
      const out = {
        manifest: r.manifest.fixtures,
        scenes: db.select().from(scene).all(),
        assets: db.select().from(asset).orderBy(asc(asset.seq)).all(),
        props: db.select().from(prop).orderBy(asc(prop.seq)).all(),
      };
      closeDb(db);
      return out;
    };
    const a = await load();
    expect(a.manifest.slice(-2)).toEqual(["scn-prop-images", "scn-props"]);
    const names = a.assets.slice(-3).map((x) => x.name);
    expect(names).toEqual(["prop-barrel", "prop-table", "prop-chest"]);
    const img = Object.fromEntries(a.assets.map((x) => [x.name, x]));
    expect(img["prop-table"]).toMatchObject({ width: 128, height: 256 });
    const ambush = a.scenes.find((s) => s.name === "Goblin Ambush");
    expect(a.props.map(({ id: _i, seq: _s, createdAt: _c, updatedAt: _u, ...p }) => p)).toEqual([
      {
        campaignId: ambush?.campaignId as string,
        sceneId: ambush?.id as string,
        assetId: img["prop-barrel"]?.id as string,
        col: 5,
        row: 3,
        w: 1,
        h: 1,
        rotation: 0,
        z: 0,
        hidden: false,
        locked: false,
        fogged: false,
      },
      {
        campaignId: ambush?.campaignId as string,
        sceneId: ambush?.id as string,
        assetId: img["prop-table"]?.id as string,
        col: 4,
        row: 11,
        w: 2,
        h: 1,
        rotation: 90,
        z: 0,
        hidden: false,
        locked: false,
        fogged: false,
      },
      {
        campaignId: ambush?.campaignId as string,
        sceneId: ambush?.id as string,
        assetId: img["prop-chest"]?.id as string,
        col: 17,
        row: 12,
        w: 1,
        h: 1,
        rotation: 0,
        z: 0,
        hidden: true,
        locked: false,
        fogged: false,
      },
    ]);
    // FR-FIX-08 / FR-ASSET-18: a second load gives the same IDs and fields.
    const b = await load();
    expect(b.props).toEqual(a.props);
    expect(b.assets.map((x) => x.id)).toEqual(a.assets.map((x) => x.id));
  });
});
