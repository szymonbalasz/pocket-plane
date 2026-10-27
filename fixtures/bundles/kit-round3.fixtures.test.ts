// Bundle `kit-round3` (kit parity K13, DM #363): `theme-gilt` + Mira's spell slots and Hunter's
// Mark + the SRD mini set + Mira's pet + the DM's open roll request. Loads from empty; the records
// the K13 walkthrough reads; CON-44 ceilings with the measured figures.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { compendiumEntry, creatureSheet, entity } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-round3";

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

describe("kit-round3 bundle (kit parity K13)", () => {
  test("FR-CHARX-114 K13 kit-round3 loads from empty: Mira's slots (1 of 2 used), Hunter's Mark and Second Wind; SRD monsters; Mira's pet", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-6)).toEqual([
      "kit-mira-spells",
      "cbtx-effects",
      "cmp-srd-mini",
      "cp-srd",
      "pet-owlbear",
      "dicex-request-open",
    ]);
    const mira = db
      .select()
      .from(entity)
      .all()
      .find((e) => e.name === "Mira");
    const sheet = db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, mira?.id as string))
      .get();
    if (!sheet) throw new Error("Mira has no sheet row");
    expect(sheet.slotsUsed).toEqual({ "1": 1 });
    expect((sheet.spells as { name: string }[]).map((s) => s.name)).toEqual(["Hunter's Mark"]);
    const uses = (sheet.features as { name: string; usesMax?: number }[]).filter((f) => f.usesMax);
    expect(uses.map((f) => f.name)).toEqual(["Second Wind"]);
    const monsters = db
      .select()
      .from(compendiumEntry)
      .all()
      .filter((e) => e.kind === "monster");
    expect(monsters.map((e) => e.name)).toContain("Goblin");
  }, 60_000);

  test("CON-44 kit-round3 snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-round3: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
