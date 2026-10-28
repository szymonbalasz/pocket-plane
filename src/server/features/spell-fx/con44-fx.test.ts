// VFX §12 CON-44 (ceilings DM 1.5 MiB since #256, players 512 KiB; spec: the DM frame stays under
// 768 KiB): the realistic-heavy harness on `session-sim`, then the worst-case map effects written
// straight to the rows: `fx` on its 6 concentrations (Spirit Guardians necrotic 60 ft, a
// UUID-length `spellId`), and `fx` on every concentration spell row of the heavy sheets. Players
// pay for the concentrations they receive (PC effects: all of them) and their own sheet's rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { FX_MAX_BYTES, Fx, SpellRowFx } from "@shared/spell-fx/fx";
import { and, eq, isNull } from "drizzle-orm";
import { campaign, creatureSheet, effect } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";

/** VFX §12: the DM frame's own bound for this feature. */
const DM_FX_MAX = 768 * 1024;
const WORST_ROW_FX = SpellRowFx.parse({
  preset: "spirit-guardians",
  params: { variant: "necrotic", radiusFt: 60 },
});
const worstFx = (spellId: string) => Fx.parse({ ...WORST_ROW_FX, spellId });
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe("VFX §12 CON-44 fx on the heavy harness", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  let concentrations = 0;
  let rows = 0;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadInProcess(library, "session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    before = snapshotSizes(b.s);
    const concs = db
      .select()
      .from(effect)
      .where(
        and(eq(effect.campaignId, cid), eq(effect.kind, "concentration"), isNull(effect.endedAt)),
      )
      .all();
    for (const [i, e] of concs.entries()) {
      const spellId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      db.update(effect)
        .set({ fx: worstFx(spellId) })
        .where(eq(effect.id, e.id))
        .run();
    }
    concentrations = concs.length;
    for (const s of db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.campaignId, cid))
      .all()) {
      const spells = (s.spells as { concentration: boolean }[]).map((r) =>
        r.concentration ? { ...r, fx: WORST_ROW_FX } : r,
      );
      rows += spells.filter((r) => "fx" in r).length;
      db.update(creatureSheet).set({ spells }).where(eq(creatureSheet.entityId, s.entityId)).run();
    }
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("VFX §12 fx on the 6 concentrations + concentration spell rows: DM < 768 KiB, players < 512 KiB", () => {
    expect(concentrations).toBe(6);
    expect(bytes(worstFx("00000000-0000-4000-8000-000000000000"))).toBeLessThanOrEqual(
      FX_MAX_BYTES,
    );
    const [dm, ...players] = after as [ViewerSize, ...ViewerSize[]];
    const delta = (i: number, type?: string) =>
      type === undefined
        ? (after[i]?.bytes ?? 0) - (before[i]?.bytes ?? 0)
        : (after[i]?.types[type]?.bytes ?? 0) - (before[i]?.types[type]?.bytes ?? 0);
    console.log(
      `VFX CON-44: ${concentrations} concentrations, ${rows} spell rows with fx (${bytes(WORST_ROW_FX)} B each, effect fx ${bytes(worstFx("x".repeat(36)))} B); DM ${before[0]?.bytes} → ${dm.bytes} B (+${delta(0)}: effect +${delta(0, EFFECT_TYPE)}, sheets +${delta(0, CREATURE_SHEET_TYPE)}), ${DM_FX_MAX - dm.bytes} B left of 768 KiB; players +${Math.min(...players.map((_, i) => delta(i + 1)))}…+${Math.max(...players.map((_, i) => delta(i + 1)))} B, max ${Math.max(...players.map((p) => p.bytes))} B of 512 KiB`,
    );
    // Each effect `fx` costs its JSON plus the key (null → object); the DM pays for all six.
    expect(delta(0, EFFECT_TYPE)).toBeLessThanOrEqual(concentrations * FX_MAX_BYTES);
    expect(dm.bytes).toBeLessThan(DM_FX_MAX);
    expect(dm.bytes).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
  });
});
