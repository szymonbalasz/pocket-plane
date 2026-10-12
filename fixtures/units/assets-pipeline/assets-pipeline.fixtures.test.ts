import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { closeDb } from "@server/db/client";
import { asset, campaign } from "@server/db/schema";
import { readEventLog } from "@server/events/log";
import { asc } from "drizzle-orm";
import sharp from "sharp";
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

/** Loads a bundle, reads what the tests need, closes the DB at once. */
async function loaded(bundle: string) {
  const r = await loadBundle(bundle);
  dirs.push(r.dir);
  const db = r.openDb();
  const rows = db.select().from(asset).orderBy(asc(asset.seq)).all();
  const campaigns = db.select().from(campaign).all();
  const ingested = readEventLog(db).filter((e) => e.type === "AssetIngested");
  closeDb(db);
  const files = (hash: string, f: string) => readFileSync(path.join(r.config.assetDir, hash, f));
  return { ...r, rows, campaigns, ingested, files };
}

describe("asset fixtures (FR-ASSET-18)", () => {
  test("FR-ASSET-18 asset-library: images, image-large, images-second as specified", async () => {
    const r = await loaded("asset-library");
    const fixture = r.campaigns.find((c) => c.name === "Fixture Campaign");
    const second = r.campaigns.find((c) => c.name === "Second Campaign");
    expect(fixture?.active).toBe(true);
    const mine = r.rows.filter((a) => a.campaignId === fixture?.id);
    expect(mine.map((a) => a.name)).toEqual([
      "town",
      "battlemap",
      "token-mira",
      "token-goblin",
      "token-wolf",
      "token-elite",
      "map-large",
    ]);
    const by = (n: string) => mine.find((a) => a.name === n);
    expect([by("battlemap")?.displayWidth, by("battlemap")?.displayHeight]).toEqual([1400, 980]);
    expect([by("town")?.width, by("town")?.height]).toEqual([1400, 980]);
    expect([by("token-mira")?.width, by("token-mira")?.height]).toEqual([256, 256]);
    expect(mine.every((a) => a.mime === "image/png")).toBe(true);

    const large = by("map-large");
    expect([large?.width, large?.height]).toEqual([6000, 4000]);
    expect([large?.displayWidth, large?.displayHeight]).toEqual([4096, 2731]);
    const thumb = await sharp(r.files(large?.hash as string, "thumb.webp")).metadata();
    expect([thumb.width, thumb.height]).toEqual([512, 341]);

    const copy = r.rows.filter((a) => a.campaignId === second?.id);
    expect(copy.map((a) => a.name)).toEqual(["Town (copy)"]);
    expect(copy[0]?.hash).toBe(by("town")?.hash as string);
    expect(copy[0]?.id).not.toBe(by("town")?.id as string);

    // Manifest lists asset IDs by fixture key (FIX §8); one log entry per created asset.
    expect(r.manifest.records.images?.asset).toEqual(mine.slice(0, 6).map((a) => a.id));
    expect(r.manifest.records["image-large"]?.asset).toEqual([large?.id as string]);
    expect(r.manifest.records["images-second"]?.asset).toEqual([copy[0]?.id as string]);
    expect(r.ingested).toHaveLength(8);
  });

  test("FR-ASSET-18 two loads: identical IDs and record fields, hashes and file bytes", async () => {
    const a = await loaded("asset-library");
    const b = await loaded("asset-library");
    expect(b.rows).toEqual(a.rows);
    for (const row of a.rows) {
      for (const f of ["original", "display.webp", "thumb.webp"]) {
        expect(b.files(row.hash, f).equals(a.files(row.hash, f))).toBe(true);
      }
    }
    // A fixture's asset IDs are the same in every bundle that includes it (FR-FIX-08).
    const s = await loaded("session-sim");
    expect(s.manifest.records.images?.asset).toEqual(a.manifest.records.images?.asset);
  });

  test("FR-ASSET-08 seeded asset IDs keep the 128-bit base64url format", async () => {
    const r = await loaded("session-sim");
    expect(r.rows).toHaveLength(6);
    for (const row of r.rows) expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
