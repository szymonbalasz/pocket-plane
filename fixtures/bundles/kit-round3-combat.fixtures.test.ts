// Bundle `kit-round3-combat` (kit parity K12, DM #363): `kit-parity` + `kit-groups`. Loads from empty:
// the round-3 fight with Mira's in-turn Fire Elemental (a line in her row) and Thorn's
// after-owner one (a child row under his); CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { combatant, encounter, entity } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-round3-combat";

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

describe("kit-round3-combat bundle (kit parity K12)", () => {
  test("FR-KIT-29 kit-round3-combat loads from empty: kit-parity's round 3 + an in-turn and an after-owner Fire Elemental", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.at(-1)).toBe("kit-groups");
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    expect(enc?.round).toBe(3);
    const rows = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .all();
    expect(rows).toHaveLength(8);
    const owners = new Map(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => [e.id, e.name]),
    );
    const modes = rows
      .filter((c) => c.ownerCharacterId)
      .map((c) => [owners.get(c.ownerCharacterId as string), c.turnMode])
      .sort();
    expect(modes).toEqual([
      ["Mira", "in-owner-turn"],
      ["Thorn", "after-owner"],
    ]);
  }, 60_000);

  test("CON-44 kit-round3-combat snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(
      `CON-44 kit-round3-combat: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`,
    );
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
