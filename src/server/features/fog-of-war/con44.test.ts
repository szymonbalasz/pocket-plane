// FOG §12 / §13 CON-44 under the picked option (OQ-FOG-04 B, decided #196: token window + SCN
// window): the realistic-heavy harness with fog on (new scenes fogged, FR-FOG-02; the battle
// scene revealed, FR-FOG-25). DM: every scene's compact `fog` row, never windowed; players: the
// active scene's only; tokens on the other new scenes carry `fogged: true` in their scene loads.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { FOG_TYPE } from "@shared/fog-of-war/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  HEAVY,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
} from "../../ws/testing/snapshot-size";

/** ADR-0041 re-baseline: the heavy DM keeps ≥ 100 KiB under its ceiling. */
const HEAVY_DM_HEADROOM = 100 * 1024;
/** FOG §12: a `fog` row ≈ 170 B + runs + the DM's undo info. */
const FOG_ROW_DM_MAX = 400;

describe("CON-44 with fog (FOG §12)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
  }, 60_000);
  afterAll(() => b.cleanup());

  test("CON-44 FOG §12 heavy: DM every scene's fog row (compact, never windowed), players the active one; ceilings + DM headroom hold", () => {
    const sizes = snapshotSizes(b.s);
    const [dm, ...players] = sizes;
    const fog = dm?.types[FOG_TYPE];
    expect(fog?.rows).toBe(HEAVY.scenes);
    expect((fog?.bytes ?? Infinity) / HEAVY.scenes).toBeLessThan(FOG_ROW_DM_MAX);
    for (const p of players) expect(p.types[FOG_TYPE]?.rows).toBe(1);
    expect(SNAPSHOT_CEILING.dm - (dm?.bytes ?? Infinity)).toBeGreaterThanOrEqual(HEAVY_DM_HEADROOM);
    for (const p of players) expect(p.bytes).toBeLessThanOrEqual(SNAPSHOT_CEILING.player);
    console.log(
      `FOG CON-44: heavy DM ${dm?.bytes} B (fog ${fog?.rows} rows, ${fog?.bytes} B; ${SNAPSHOT_CEILING.dm - (dm?.bytes ?? 0)} B left); players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B`,
    );
  });

  test("FR-FOG-25 heavy: the revealed battle scene's 60 tokens reach every player; no player token row is fogged unless owned", () => {
    const frames = snapshotFrames(b.s);
    for (const f of frames) {
      const tokens = (f.records[TOKEN_TYPE] ?? []) as {
        fogged?: boolean;
        ownerPlayerId?: string;
      }[];
      expect(tokens).toHaveLength(HEAVY.activeSceneTokens);
      expect(tokens.filter((t) => t.fogged === true)).toEqual([]);
    }
    const fogs = frames.find((f) => f.viewer.role === "player")?.records[FOG_TYPE] as {
      fill: string;
      runs: string;
    }[];
    expect(fogs).toEqual([expect.objectContaining({ fill: "clear", runs: "" })]);
  });

  test("FR-FOG-02 heavy: tokens on the new (fogged) scenes carry `fogged: true` in the DB", () => {
    const n = (sql: string) => b.s.db.$client.query<{ n: number }, []>(sql).get()?.n ?? Number.NaN;
    const fogged = n("SELECT count(*) AS n FROM token WHERE fogged = 1");
    expect(fogged).toBeGreaterThan(HEAVY.tokens / 2);
    expect(fogged).toBeLessThan(HEAVY.tokens - HEAVY.activeSceneTokens + 1);
    console.log(`FOG CON-44: ${fogged} of ${n("SELECT count(*) AS n FROM token")} tokens fogged`);
  });
});
