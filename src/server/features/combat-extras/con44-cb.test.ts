// CBTX §12 sprint 8 CON-44 for CB0 (#256 ceilings: DM 1.5 MiB, players 512 KiB, never raised):
// the realistic-heavy harness on `session-sim` (46-combatant started fight). `tieOrder` is on every
// DM `combatant` row (null or a number); no player frame carries it, so arranging every tie leaves
// every player snapshot byte-identical. Figures logged.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { eq } from "drizzle-orm";
import { combatant } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";

/** CB0's own bound: `tieOrder` on every DM combatant row (measured +644 B on 46 rows at spec time). */
const DM_TIE_ORDER_MAX = 1_000;

function expectCeilings(sizes: ViewerSize[]) {
  for (const v of sizes) {
    const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
    expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({ viewer: v.label, over: false });
  }
}

/** The DM frame's `combatant` bytes with and without the `tieOrder` key. */
function dmTieOrderBytes(b: Awaited<ReturnType<typeof servicesFromBundle>>) {
  const dm = snapshotFrames(b.s).find((f) => f.viewer.role === "dm");
  const rows = (dm?.records[COMBATANT_TYPE] ?? []) as Record<string, unknown>[];
  const withKey = Buffer.byteLength(JSON.stringify(rows), "utf8");
  const without = Buffer.byteLength(
    JSON.stringify(rows.map(({ tieOrder: _t, ...r }) => r)),
    "utf8",
  );
  return { rows: rows.length, delta: withKey - without };
}

describe("CON-44 with CB0 tie order (CBTX §12 sprint 8, #256)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("FR-CBTX-67 CON-44 tie order: DM bound, players byte-identical, ceilings hold", () => {
    const before = snapshotSizes(b.s);
    expectCeilings(before);
    const nulls = dmTieOrderBytes(b);
    expect(nulls.rows).toBeGreaterThanOrEqual(46);
    // Worst: every active row arranged (`tieOrder` = its position, up to two digits).
    for (const r of b.s.db.select().from(combatant).where(eq(combatant.active, true)).all()) {
      b.s.db
        .update(combatant)
        .set({ tieOrder: Math.max(1, r.position) })
        .where(eq(combatant.id, r.id))
        .run();
    }
    const after = snapshotSizes(b.s);
    expectCeilings(after);
    const set = dmTieOrderBytes(b);
    const worst = Math.max(nulls.delta, set.delta);
    expect(worst).toBeLessThanOrEqual(DM_TIE_ORDER_MAX);
    const players = (s: ViewerSize[]) => s.filter((v) => v.role === "player").map((v) => v.bytes);
    expect(players(after)).toEqual(players(before));
    for (const f of snapshotFrames(b.s).filter((x) => x.viewer.role === "player")) {
      expect(JSON.stringify(f.records)).not.toContain("tieOrder");
    }
    const dm = (s: ViewerSize[]) => s.find((v) => v.role === "dm")?.bytes ?? 0;
    console.log(
      `CB0 CON-44: ${nulls.rows} DM combatant rows, tieOrder +${nulls.delta} B (null) / +${set.delta} B (set); DM ${dm(before)} → ${dm(after)} B of ${SNAPSHOT_CEILING.dm}; players worst ${Math.max(...players(after))} B of ${SNAPSHOT_CEILING.player} (unchanged)`,
    );
  });
});
