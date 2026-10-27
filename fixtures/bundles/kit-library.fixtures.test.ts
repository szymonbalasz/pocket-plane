// Bundle `kit-library` (kit parity §13 K4): `theme-gilt` + the SRD mini set + Mira's pet Owlbear.
// Loads from empty; the records the K4 walkthrough reads; CON-44 ceilings with the measured figures.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { compendiumEntry, entity } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { loadBundle } from "../index";

const BUNDLE = "kit-library";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

describe("kit-library bundle (kit parity §13 K4)", () => {
  test("FR-KIT-76 FR-KIT-82 kit-library loads from empty: SRD monsters for the table, Mira and Thorn, Mira's pet Owlbear", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-3)).toEqual(["cmp-srd-mini", "cp-srd", "pet-owlbear"]);
    const monsters = db
      .select()
      .from(compendiumEntry)
      .all()
      .filter((e) => e.kind === "monster");
    expect(monsters.map((e) => e.name)).toContain("Goblin");
    const names = db
      .select()
      .from(entity)
      .all()
      .map((e) => [e.kind, e.name]);
    expect(names).toContainEqual(["character", "Mira"]);
    expect(names).toContainEqual(["character", "Thorn"]);
    expect(names).toContainEqual(["monster", "Owlbear"]);
  }, 60_000);

  test("CON-44 kit-library snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-library: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
