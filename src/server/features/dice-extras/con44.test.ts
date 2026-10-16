// DICEX §12 CON-44 (#208 ceilings: DM 1 MiB, players 512 KiB, no headroom guard): the realistic
// heavy harness on `session-sim` + `dicex-looks`, then a `dice-look` row for the DM and each of the
// 6 players at max length (36-char ids, an 8-char style, `plastic`). DICEX's own bound: `dice-look`
// ≤ 2.5 KB in the DM frame; every player frame carries the same rows (full visibility).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { library } from "@fixtures/index";
import { DICE_LOOK_TYPE, DM_LOOK_KEY } from "@shared/dice-extras/looks";
import { eq } from "drizzle-orm";
import { campaign, diceLook, player } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { loadInProcess } from "../fixtures-adapters/loader";

/** DICEX §12: `dice-look` in the DM frame (7 rows measured 2,157 B at the seams pass). */
const DICE_LOOK_MAX = 2_500;
const AT = "2026-01-01T00:00:00.000Z";
const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);

describe("CON-44 with DICEX dice looks (DICEX §12, #208)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  beforeAll(async () => {
    const lib = {
      fixtures: library.fixtures,
      bundles: [
        ...library.bundles,
        { name: "session-sim-dicex", includes: ["session-sim"], fixtures: ["dicex-looks"] },
      ],
    };
    b = await servicesFromBundle(await loadInProcess(lib, "session-sim-dicex", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    // The units' 2 rows composed with session-sim (seams S10); then the worst case.
    expect(db.select().from(diceLook).where(eq(diceLook.campaignId, cid)).all()).toHaveLength(2);
    db.delete(diceLook).where(eq(diceLook.campaignId, cid)).run();
    before = snapshotSizes(b.s);
    const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
    expect(players).toHaveLength(6);
    for (const [i, p] of [null, ...players].entries()) {
      db.insert(diceLook)
        .values({
          id: x(36, `look${i}-`),
          campaignId: cid,
          ownerKey: p?.id ?? DM_LOOK_KEY,
          ownerPlayerId: p?.id ?? null,
          style: "amethyst",
          body: "#6b3fa0",
          pips: "#f4ecff",
          material: "plastic",
          updatedAt: AT,
        })
        .run();
    }
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("CON-44 DICEX §12 heavy + 7 looks (#208): DM < 1 MiB, players < 512 KiB; dice-look ≤ 2.5 KB DM", () => {
    const [dm, ...players] = after;
    const looks = dm?.types[DICE_LOOK_TYPE];
    const deltas = after.map((v, i) => v.bytes - (before[i]?.bytes ?? 0));
    console.log(
      `DICEX CON-44 (D2): dice-look DM ${looks?.bytes} B (${looks?.rows} rows); heavy DM ${before[0]?.bytes} → ${dm?.bytes} B (+${deltas[0]}; ${SNAPSHOT_CEILING.dm - (dm?.bytes ?? 0)} B left of 1 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B (+${Math.min(...deltas.slice(1))}…+${Math.max(...deltas.slice(1))})`,
    );
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(looks?.rows).toBe(7);
    expect(looks?.bytes ?? Infinity).toBeLessThanOrEqual(DICE_LOOK_MAX);
    // FR-DICEX-25: every player frame has every row, byte for byte the DM's.
    for (const p of players) expect(p.types[DICE_LOOK_TYPE]).toEqual(looks);
    for (const d of deltas) expect(d).toBeLessThanOrEqual(DICE_LOOK_MAX);
  });
});
