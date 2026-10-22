// Sprint-8 gate bundle (seams S15, review A #7): `session-sim-12` loads from empty on top of
// session-sim-11 (its units, its running ambush). TT0 creates it empty; each sprint-8 slice that
// appends a unit extends the expectations here.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { asset, campaign, rollMacro, rollRequest } from "@server/db/schema";
import { eq } from "drizzle-orm";
import { loadBundle } from "../index";

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

describe("session-sim-12 (sprint-8 gate bundle)", () => {
  test("FR-DICEX-93 session-sim-12 loads from empty: session-sim-11 + the sprint-8 section", async () => {
    const r = await loadBundle("session-sim-12", { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining(["st-past-crypt", "cmp-goblin-untyped", "cp-ally", "fu-hurt-goblins"]),
    );
    // TT0 adds no unit: no table-tools rows yet; the campaign runs with no sound picks.
    expect(db.select().from(rollMacro).all()).toEqual([]);
    expect(db.select().from(rollRequest).all()).toEqual([]);
    expect(db.select().from(asset).where(eq(asset.kind, "audio")).all()).toEqual([]);
    const active = db.select().from(campaign).where(eq(campaign.active, true)).get();
    expect([active?.pause, active?.alertSounds]).toEqual([null, {}]);
  }, 120_000);
});
