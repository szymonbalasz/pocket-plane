// CON-44 for S4-1a (#208 ceilings: DM 1 MiB, players 512 KiB): the one new wire field is the
// `roll` item's `part {type, extra}` (FR-CHARX-55). Measured on the realistic-heavy harness with
// MOD's S4-0 roll-entry growth (30 attack entries with 2 extra part rolls of 12 dice), once
// without and once with `part` on the base and both extra items; the stat block fields were
// measured by S4-0 (MOD `con44.test.ts`).
import { beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { RollEntryDmPayload, RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";

/** S4-1a's own bound: `part` on 90 roll items, ≤ 8 KiB for any viewer. */
const PART_MAX = 8 * 1024;
const ENTRIES = 30;

describe("CON-44 with weapon part markers (FR-CHARX-55)", () => {
  let base: ViewerSize[];
  let plain: ViewerSize[];
  let parted: ViewerSize[];
  let n = 0;
  beforeAll(async () => {
    const b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    base = snapshotSizes(b.s);
    const entries = db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.kind, "roll"))
      .all()
      .filter((e) => (e.payload as RollEntryPayload).length === 2)
      .slice(0, ENTRIES);
    n = entries.length;
    const grow = (withPart: boolean) => {
      for (const e of entries) {
        // FR-CHARX-129 (#385): new damage items carry `part` already; measure without it.
        const [hit, parted] = e.payload as RollEntryPayload;
        const { part: _part, ...dmg } = parted as NonNullable<typeof parted>;
        const label = String(dmg?.label).slice(0, 48);
        const xItem = (i: number) => ({
          ...dmg,
          rollId: `${e.id}-x${i}`,
          expression: "6d12+10",
          dice: Array.from({ length: 12 }, () => ({ faces: 12, value: 12, kept: true })),
          constant: 10,
          total: 154,
          natural: null,
          label: `${label} (lightning)`,
          ...(withPart ? { part: { type: "lightning", extra: true } } : {}),
        });
        const baseItem = withPart ? { ...dmg, part: { type: "bludgeoning", extra: false } } : dmg;
        const dm = e.dmPayload as RollEntryDmPayload | null;
        db.update(gameLogEntry)
          .set({
            payload: [hit, baseItem, xItem(1), xItem(2)],
            ...(dm
              ? { dmPayload: { ...dm, items: [...dm.items, { mods: [] }, { mods: [] }] } }
              : {}),
          })
          .where(eq(gameLogEntry.id, e.id))
          .run();
      }
      return snapshotSizes(b.s);
    };
    plain = grow(false);
    parted = grow(true);
  }, 120_000);

  test("FR-CHARX-55 CON-44: part markers stay small; DM < 1 MiB, players < 512 KiB", () => {
    const delta = parted.map((s, i) => s.bytes - (plain[i]?.bytes ?? 0));
    const [dm = 0, ...players] = delta;
    const max = (v: number[]) => Math.max(...v);
    console.log(
      `CHARX CON-44 (S4-1a): heavy base DM ${base[0]?.bytes} B; ${n} roll entries × 3 part items: ` +
        `part markers DM +${dm} B, players +${Math.min(...players)}…+${max(players)} B; ` +
        `with S4-0's extra rolls DM ${parted[0]?.bytes} B, players max ${max(parted.slice(1).map((p) => p.bytes))} B`,
    );
    expect(n).toBe(ENTRIES);
    expect(dm).toBeGreaterThan(0);
    for (const d of delta) expect(d).toBeLessThanOrEqual(PART_MAX);
    expect(parted[0]?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of parted.slice(1)) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
  });
});
