// DICE §12 / FR-DICE-71 CON-44 (sprint 7, GM1; ceilings DM 1.5 MiB since #256, players 512 KiB):
// the realistic-heavy harness on `session-sim`, gems on, then the spec's worst case written
// straight to the rows: 33 superseded `roll` entries (36-char `supersededBy`) and 33 `replaces`
// markers in the 100-entry window. Measured here +3,564 B per viewer (the spec's +2,816 B
// counted a shorter `replaces`: a 36-char `entryId` + total is 75 B a marker, not 51 B); bound
// 3.6 KB (reported at GM1 for the spec's "≤ 3 KB"). 0 B with no reroll.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { GAME_LOG_ENTRY_TYPE, type RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { and, desc, eq } from "drizzle-orm";
import { campaign, gameLogEntry } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { setFeature } from "../campaign-management/features";
import { loadInProcess } from "../fixtures-adapters/loader";

/** FR-DICE-71: 33 + 33 markers per viewer (measured 3,564 B). */
const SUPERSEDE_MAX = 3_600;
const MARKS = 33;
const id36 = (n: number) => `e${n}-${"x".repeat(36)}`.slice(0, 36);

describe("FR-DICE-71 CON-44 supersede (DICE §12)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  let rolls = 0;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    b.s.commands.run(
      setFeature,
      { feature: GEMS_FEATURE, on: true },
      { actor: { role: "dm", playerId: null, campaignId: cid } },
    );
    before = snapshotSizes(b.s);
    // The window's `roll` entries, newest first: the first 33 superseded, the next 33 marked.
    const window = db
      .select()
      .from(gameLogEntry)
      .where(and(eq(gameLogEntry.campaignId, cid), eq(gameLogEntry.kind, "roll")))
      .orderBy(desc(gameLogEntry.n))
      .limit(2 * MARKS)
      .all();
    rolls = window.length;
    window.forEach((e, i) => {
      if (i < MARKS) {
        db.update(gameLogEntry)
          .set({ supersededBy: id36(i) })
          .where(eq(gameLogEntry.id, e.id))
          .run();
        return;
      }
      const items = e.payload as RollEntryPayload;
      const payload = items.map((it, j) =>
        j === 0 ? { ...it, replaces: { entryId: id36(i), total: 999 } } : it,
      );
      db.update(gameLogEntry).set({ payload }).where(eq(gameLogEntry.id, e.id)).run();
    });
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("FR-DICE-71 CON-44 supersede: 33 superseded + 33 `replaces` ≤ 3.6 KB per viewer; under the ceilings", () => {
    expect(rolls).toBe(2 * MARKS);
    const deltas = after.map((v, i) => v.bytes - (before[i]?.bytes ?? 0));
    const [dm, ...players] = after;
    console.log(
      `DICE CON-44 (GM1): heavy + gems on DM ${before[0]?.bytes} → ${dm?.bytes} B (+${deltas[0]}); players +${Math.min(...deltas.slice(1))}…+${Math.max(...deltas.slice(1))}, max ${Math.max(...players.map((p) => p.bytes))} B; game-log-entry DM ${dm?.types[GAME_LOG_ENTRY_TYPE]?.bytes} B`,
    );
    for (const d of deltas) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(SUPERSEDE_MAX);
    }
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
  });
});
