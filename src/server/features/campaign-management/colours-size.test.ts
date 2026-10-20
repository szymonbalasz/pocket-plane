// CON-44 free colour (CAMP FR-CAMP-37, §12 sprint 6): on the realistic heavy session
// (session-sim + `buildRealisticHeavy` + `writeWorstPresents`), every colour field a hex. Growth
// over the frame without colour fields ≤ 160 B per viewer; −3 B a field vs the worst sprint-5
// key (`vermillion`), +2 B vs all-Amber; ceilings hold (DM 1.5 MiB, players 512 KiB). The
// cumulative worst case in `ws/snapshot-size.test.ts` keeps `vermillion`, which stays the larger.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { writeWorstPresents } from "../party-board/testing";
import { migratePlayerColors } from "./colors";

describe("CON-44 free colour (realistic heavy)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const cid = b.s.db.$client
      .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
      .get()?.id as string;
    writeWorstPresents(b.s.db, cid);
  }, 60_000);
  afterAll(() => b.cleanup());

  /** Each viewer's frame bytes with every colour field set to `value` (null: fields dropped). */
  function frames(value: string | null): number[] {
    const sql = b.s.db.$client;
    if (value !== null) {
      sql.query("UPDATE player SET color = ?").run(value);
      sql.query("UPDATE campaign SET dm_color = ?").run(value);
      return snapshotSizes(b.s).map((v) => v.bytes);
    }
    return snapshotFrames(b.s).map(({ viewer: v, records }) => {
      const strip = (rows: unknown[], key: string) =>
        rows.map((r) =>
          Object.fromEntries(
            Object.entries(r as Record<string, unknown>).filter(([k]) => k !== key),
          ),
        );
      const out = {
        ...records,
        player: strip(records.player ?? [], "color"),
        campaign: strip(records.campaign ?? [], "dmColor"),
      };
      const you = { campaignId: v.campaignId, role: v.role, playerId: v.playerId };
      return Buffer.byteLength(JSON.stringify({ type: "snapshot", seq: 0, you, records: out }));
    });
  }

  test("CON-44 free colour: every colour field a hex → growth ≤ 160 B per viewer over no colour fields; −3 B a field vs `vermillion`, +2 B vs `amber`; the migration's output measures the same; ceilings hold", () => {
    const none = frames(null);
    const amber = frames("amber");
    const vermillion = frames("vermillion");
    const hex = frames("#d55e00");
    const sizes = snapshotSizes(b.s);
    const fields = snapshotFrames(b.s).map(
      ({ records }) => (records.player?.length ?? 0) + (records.campaign?.length ?? 0),
    );
    for (const [i, v] of sizes.entries()) {
      const growth = (hex[i] as number) - (none[i] as number);
      expect({ viewer: v.label, ok: growth > 0 && growth <= 160 }).toEqual({
        viewer: v.label,
        ok: true,
      });
      const f = fields[i] as number;
      expect(f).toBeGreaterThanOrEqual(7); // 6 players + the campaign
      expect((hex[i] as number) - (vermillion[i] as number)).toBe(-3 * f);
      expect((hex[i] as number) - (amber[i] as number)).toBe(2 * f);
    }
    expectUnder(sizes);

    // The boot migration turns the keys into hex of the same length: same bytes as any hex.
    b.s.db.$client.run("UPDATE player SET color = 'vermillion'");
    b.s.db.$client.run("UPDATE campaign SET dm_color = 'vermillion'");
    migratePlayerColors(b.s.db);
    expect(snapshotSizes(b.s).map((v) => v.bytes)).toEqual(hex);

    const [dm, ...players] = sizes as [ViewerSize, ...ViewerSize[]];
    console.log(
      `CAMP S6 free colour CON-44: hex +${(hex[0] as number) - (none[0] as number)} B DM over no colour fields (${(hex[0] as number) - (vermillion[0] as number)} B vs vermillion, +${(hex[0] as number) - (amber[0] as number)} B vs amber); heavy DM ${dm.bytes} B (${SNAPSHOT_CEILING.dm - dm.bytes} B left of 1.5 MiB); players max ${Math.max(...players.map((p) => p.bytes))} B of 512 KiB`,
    );
  });
});

function expectUnder(sizes: ViewerSize[]) {
  for (const v of sizes) {
    const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
    expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({ viewer: v.label, over: false });
  }
}
