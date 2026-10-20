// ASSET §13.1 fixtures (IM-1): `image-tags`, bundles `image-search` and `session-sim-10` load from
// empty on top of `session-sim-9`'s running encounter; deterministic; no null `tags` row (review
// #25); the `images` unit's tags; built-in counts the walkthrough relies on.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { asset, campaign, encounter } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../../index";
import { IMAGE_TAGS_FIXTURE as F } from "./image-tags";

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
  const r = await loadBundle(bundle, { testMode: true });
  dirs.push(r.dir);
  const db = r.openDb();
  const fixture = db.select().from(campaign).where(eq(campaign.name, "Fixture Campaign")).get();
  const rows = db.select().from(asset).orderBy(asc(asset.seq)).all();
  const encounters = db.select().from(encounter).all();
  closeDb(db);
  return { ...r, rows, encounters, fixtureId: fixture?.id as string };
}

/** Listed Fixture Campaign images holding `tag`, by name. */
const holding = (rows: Awaited<ReturnType<typeof loaded>>["rows"], cid: string, tag: string) =>
  rows
    .filter((a) => a.campaignId === cid && a.listed && a.tags?.includes(tag))
    .map((a) => a.name)
    .sort();

describe("image-tags fixtures (ASSET §13.1)", () => {
  test("FR-ASSET-39 session-sim-10 loads: image-search and session-sim-10 from empty, on top of session-sim-9's running encounter (still running); two loads identical; no asset row null", async () => {
    const sim9 = await loaded("session-sim-9");
    const running = sim9.encounters.filter((e) => e.status === "started");
    expect(running).toHaveLength(1);

    for (const bundle of ["image-search", "session-sim-10"]) {
      const a = await loaded(bundle);
      const b = await loaded(bundle);
      expect(a.manifest.status).toBe("complete");
      // Other sprint-6 slices append after it (session-sim-10 header): loaded, not last.
      expect(a.manifest.fixtures).toContain(F.key);
      // Deterministic: manifests (minus the run's own paths), asset IDs and tags.
      expect(b.manifest.records).toEqual(a.manifest.records);
      expect(b.manifest.fixtures).toEqual(a.manifest.fixtures);
      expect(b.rows.map((r) => [r.id, r.name, r.tags, r.listed])).toEqual(
        a.rows.map((r) => [r.id, r.name, r.tags, r.listed]),
      );
      // sim-9's assets keep their IDs; the encounter is untouched and still running.
      expect(a.manifest.records.images?.asset).toEqual(sim9.manifest.records.images?.asset);
      expect(a.encounters).toEqual(sim9.encounters);
      expect(a.rows.filter((r) => r.tags === null)).toEqual([]);

      const mine = a.manifest.records[F.key]?.asset ?? [];
      expect(mine).toHaveLength(F.listed.length + F.attachments.length);
      const byId = new Map(a.rows.map((r) => [r.id, r]));
      expect(
        mine.map((id) => [byId.get(id)?.name, byId.get(id)?.tags, byId.get(id)?.listed]),
      ).toEqual([
        ...F.listed.map((l) => [l.name, l.tags, true]),
        ...F.attachments.map((n) => [n, ["Handouts"], false]),
      ]);
    }
  }, 120_000);

  test("FR-ASSET-41 image-search tags: images unit Maps / Tokens; other units' images Untagged; built-in chips as the walkthrough expects", async () => {
    const r = await loaded("image-search");
    const cid = r.fixtureId;
    const listed = r.rows.filter((a) => a.campaignId === cid && a.listed);
    const imagesIds = r.manifest.records.images?.asset ?? [];
    expect(imagesIds.map((id) => listed.find((a) => a.id === id)?.tags)).toEqual([
      ["Maps"],
      ["Maps"],
      ["Tokens"],
      ["Tokens"],
      ["Tokens"],
      ["Tokens"],
      ["Tokens"],
    ]);
    // images (7) + image-tags (24) = 31 tagged-or-Misc listed images; the rest are Untagged.
    const fromUnits = new Set([...imagesIds, ...(r.manifest.records[F.key]?.asset ?? [])]);
    const others = listed.filter((a) => !fromUnits.has(a.id));
    expect(others.every((a) => a.tags?.length === 0)).toBe(true);
    expect(listed.filter((a) => fromUnits.has(a.id))).toHaveLength(31);

    expect(holding(r.rows, cid, "Maps")).toEqual(
      ["Goblin Cave", "Forest Road", "Ruined Keep", "Harbour Town", "town", "battlemap"].sort(),
    );
    expect(holding(r.rows, cid, "Portraits")).toEqual(
      ["Elite Goblin", "Mira Portrait", "Thorn Portrait", "Elder Sage"].sort(),
    );
    expect(holding(r.rows, cid, "Props")).toEqual(
      ["Wooden Chest", "Barrel Stack", "Campfire", "Goblin Totem"].sort(),
    );
    expect(holding(r.rows, cid, "Handouts")).toEqual(
      ["Wanted Poster Goblin King", "Treasure Map", "Royal Seal Letter"].sort(),
    );
    expect(holding(r.rows, cid, "Items")).toEqual(
      ["Goblin Totem", "Elven Cloak", "Potion Bottle"].sort(),
    );
    expect(holding(r.rows, cid, F.secretTag)).toEqual(["Ruined Keep"]);
    expect(listed.find((a) => a.name === "Misc Sketch")?.tags).toEqual([]);
  }, 60_000);
});

describe("CON-44 session-sim-10 (#256 ceilings)", () => {
  test("CON-44 session-sim-10 under the ceilings: DM ≤ 1.5 MiB, players ≤ 512 KiB; players unchanged by image-tags (DM assets only), only CP1's pets add player rows", async () => {
    const sizes = async (bundle: string) => {
      const b = await servicesFromBundle(await loadBundle(bundle, { testMode: true }));
      try {
        return snapshotSizes(b.s);
      } finally {
        b.cleanup();
      }
    };
    const sim9 = await sizes("session-sim-9");
    const sim10 = await sizes("session-sim-10");
    for (const v of sim10)
      expect([v.label, v.bytes <= SNAPSHOT_CEILING[v.role]]).toEqual([v.label, true]);
    // Players: every type but CP1's pet `entity` rows and their tokens byte-identical to sim-9.
    const PETS = new Set(["entity", "token"]);
    const others = (v: (typeof sim10)[number]) =>
      Object.entries(v.types).filter(([t]) => !PETS.has(t));
    expect(sim10.slice(1).map((v) => [v.label, others(v)])).toEqual(
      sim9.slice(1).map((v) => [v.label, others(v)]),
    );
    const [dm9, dm10] = [sim9[0]?.bytes ?? 0, sim10[0]?.bytes ?? 0];
    console.log(
      `CON-44 session-sim-10: DM ${dm10} B (+${dm10 - dm9} B over session-sim-9, ${sim10[0]?.types.asset?.rows} assets); players ${sim10
        .slice(1)
        .map((v, i) => `${v.label} ${v.bytes} B (+${v.bytes - (sim9[i + 1]?.bytes ?? 0)} B pets)`)
        .join(", ")}`,
    );
  }, 120_000);
});
