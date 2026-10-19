// CMP §13.1 fixtures (S5, track C): bundle `cmp-images` from empty (three attachments, two
// homebrew items with images), deterministic, the loader's attachment ids (`r.id`, manifest), and
// the unit stacked on `session-sim-9`.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { asset, campaign, compendiumEntry } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { CMP_IMAGES } from "./cmp-images";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function read(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  const out = {
    manifest: r.manifest,
    fixture: db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.name === "Fixture Campaign")?.id as string,
    assets: db.select().from(asset).orderBy(asc(asset.seq)).all(),
    entries: db.select().from(compendiumEntry).orderBy(asc(compendiumEntry.id)).all(),
  };
  closeDb(db);
  return out;
}

describe("cmp-images fixtures (CMP §13.1)", () => {
  test("FR-CMP-45 cmp-images loads from empty: three attachments; Moonlit Lantern (shared) [lantern, lantern-lit], CMP-IMG-SECRET (DM only) [relic]; every other entry has none; deterministic", async () => {
    const r = await read("cmp-images");
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining(["cmp-srd-mini", "cmp-homebrew", CMP_IMAGES.key]),
    );
    const ids = r.manifest.records[CMP_IMAGES.key]?.asset ?? [];
    const rows = ids.map((id) => r.assets.find((a) => a.id === id));
    expect(rows.map((a) => [a?.name, a?.listed, a?.campaignId, a?.width])).toEqual([
      ["lantern", false, r.fixture, 256],
      ["lantern-lit", false, r.fixture, 256],
      ["relic", false, r.fixture, 256],
    ]);
    const [lantern, lanternLit, relic] = ids;
    const byName = (n: string) => r.entries.find((e) => e.name === n);
    expect(byName(CMP_IMAGES.lantern)).toMatchObject({
      campaignId: r.fixture,
      kind: "item",
      shared: true,
      imageAssetIds: [lantern, lanternLit],
    });
    expect(byName(CMP_IMAGES.secret)).toMatchObject({
      campaignId: r.fixture,
      kind: "item",
      shared: false,
      imageAssetIds: [relic],
    });
    const others = r.entries.filter(
      (e) => e.name !== CMP_IMAGES.lantern && e.name !== CMP_IMAGES.secret,
    );
    expect(others.length).toBeGreaterThan(20);
    for (const e of others) expect(e.imageAssetIds).toEqual([]);

    const again = await read("cmp-images");
    expect({ a: again.assets, e: again.entries }).toEqual({ a: r.assets, e: r.entries });
  }, 30_000);

  test("FR-CMP-45 session-sim-9 carries cmp-images: both entries with their attachment images", async () => {
    const r = await read("session-sim-9");
    expect(r.manifest.fixtures).toContain(CMP_IMAGES.key);
    const ids = r.manifest.records[CMP_IMAGES.key]?.asset ?? [];
    expect(ids).toHaveLength(3);
    const images = (n: string) => r.entries.find((e) => e.name === n)?.imageAssetIds;
    expect(images(CMP_IMAGES.lantern)).toEqual(ids.slice(0, 2));
    expect(images(CMP_IMAGES.secret)).toEqual(ids.slice(2));
  }, 60_000);
});
