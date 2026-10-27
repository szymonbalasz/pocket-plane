// Bundle `kit-parity` (kit parity §13; K6 parity walkthrough, K7 stat block): `theme-gilt` + the
// kit tracks' units. Loads from empty: the round-3 fight with the Goblin (its stat block opens
// bound), Mira's kit log rows, a pending damage card, the effects, the SRD Goblin in the
// compendium, Mira's pet; CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  combatant,
  compendiumEntry,
  effect,
  encounter,
  entity,
  gameLogEntry,
  notification,
} from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "kit-parity";

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

describe("kit-parity bundle (kit parity §13)", () => {
  test("FR-KIT-94 FR-KIT-103 kit-parity loads from empty: round 3 with the Goblin bound to a definition, kit log rows, a pending card, effects, the SRD Goblin entry, Mira's pet", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-11)).toEqual([
      "kit-log-rolls",
      "combat-hit",
      "combat-pending",
      "cbtx-effects",
      "cbtx-temp",
      "cmp-srd-mini",
      "cp-srd",
      "pet-owlbear",
      "kit-notices-applied",
      "kit-notices",
      "dicex-request-open",
    ]);
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    expect(enc?.round).toBe(3);
    const rows = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .all();
    expect(rows).toHaveLength(6);
    // K7: the Goblin row has a definition, so Initiative ⋯ → Stat block opens it bound.
    expect(rows.find((c) => c.name === "Goblin")?.entityId).toBeTruthy();
    const log = db.select().from(gameLogEntry).all();
    expect(log.filter((e) => e.actorName === "Mira").length).toBeGreaterThanOrEqual(3);
    expect(log.some((e) => !e.public)).toBe(true);
    expect(
      db
        .select()
        .from(notification)
        .all()
        .some((n) => n.state === "pending"),
    ).toBe(true);
    // K9: player-1's pending Perception prompt (the roll-request toast with Roll + Decline).
    expect(
      db
        .select()
        .from(notification)
        .all()
        .some((n) => n.kind === "roll-request" && n.state === "pending"),
    ).toBe(true);
    expect(
      db
        .select()
        .from(effect)
        .all()
        .some((e) => e.condition === "prone"),
    ).toBe(true);
    const monsters = db
      .select()
      .from(compendiumEntry)
      .all()
      .filter((e) => e.kind === "monster")
      .map((e) => e.name);
    expect(monsters).toContain("Goblin");
    expect(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => e.name),
    ).toContain("Owlbear");
  }, 60_000);

  test("CON-44 kit-parity snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 kit-parity: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
