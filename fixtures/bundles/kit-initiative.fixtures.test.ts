// Bundle `kit-initiative` (kit-parity §13, K2): `theme-gilt` + a hit, a pending card, effects and
// temp HP. Loads from empty: round 3, Wolf's turn, Mira 6 / 12 concentrating, the Goblin prone,
// one pending damage card; CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { combatant, effect, encounter, notification } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-initiative";

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

describe("kit-initiative bundle (kit-parity §13)", () => {
  test("FR-KIT-23 kit-initiative loads from empty: round 3, Wolf's turn, a pending card, effects on the rows", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "combat-hit",
      "combat-pending",
      "cbtx-effects",
      "cbtx-temp",
    ]);
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    expect(enc?.round).toBe(3);
    const rows = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .all();
    expect(rows).toHaveLength(6);
    expect(rows.find((c) => c.id === enc?.turnCombatantId)?.name).toBe("Wolf");
    const live = db
      .select()
      .from(effect)
      .all()
      .filter((e) => !e.endedAt);
    expect(live.map((e) => e.kind).sort()).toContain("concentration");
    expect(live.some((e) => e.condition === "prone")).toBe(true);
    const pending = db
      .select()
      .from(notification)
      .all()
      .filter((n) => n.state === "pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test("CON-44 kit-initiative snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-initiative: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
