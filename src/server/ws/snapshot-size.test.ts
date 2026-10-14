// CON-44 snapshot ceilings + live-sync §12 build time (#163): session-sim and a "realistic
// heavy" session built through commands. DM ≤ 768 KiB, players ≤ 512 KiB, DM build < 200 ms.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { GAME_LOG_WINDOW } from "@shared/dice-roll-log/schemas";
import { SNAPSHOT_CEILING } from "./hub";
import {
  buildRealisticHeavy,
  CREATURE_SHEET_TYPE,
  dmBuildMs,
  HEAVY,
  servicesFromBundle,
  snapshotSizes,
  type ViewerSize,
} from "./testing/snapshot-size";

const BUILD_MS = 200;
const sessionSim = async () =>
  servicesFromBundle(await loadBundle("session-sim", { testMode: true }));

function expectUnderCeilings(sizes: ViewerSize[]) {
  for (const v of sizes) {
    const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
    expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({ viewer: v.label, over: false });
  }
}

describe("CON-44 snapshot ceilings (#163)", () => {
  test("session-sim: every viewer under its ceiling; DM build < 200 ms", async () => {
    const b = await sessionSim();
    try {
      const sizes = snapshotSizes(b.s);
      expect(sizes.map((v) => v.label)).toEqual(["DM", "P1", "P2"]);
      expectUnderCeilings(sizes);
      expect(dmBuildMs(b.s)).toBeLessThan(BUILD_MS);
    } finally {
      b.cleanup();
    }
  }, 30_000);

  describe("realistic heavy", () => {
    let b: Awaited<ReturnType<typeof sessionSim>>;
    let counts: Record<string, number>;
    beforeAll(async () => {
      b = await sessionSim();
      counts = buildRealisticHeavy(b.s);
    }, 60_000);
    afterAll(() => b.cleanup());

    test("scenario shape: 6 players, 30 scenes, 300 tokens, 20 encounters, 100 log, 20 pending, 100 loot", () => {
      expect(counts).toMatchObject({
        players: HEAVY.players,
        scenes: HEAVY.scenes,
        tokens: HEAVY.tokens,
        encounters: HEAVY.encounters,
        pendingCards: HEAVY.pendingCards,
        sheets: HEAVY.sheets,
      });
      // Applied cards add one line per target; session-sim brings its own loot.
      expect(counts.logEntries).toBeGreaterThanOrEqual(HEAVY.logEntries);
      expect(counts.loot).toBeGreaterThanOrEqual(HEAVY.loot);
    });

    test("DM ≤ 768 KiB, every player ≤ 512 KiB; DM build < 200 ms", () => {
      const sizes = snapshotSizes(b.s);
      expect(sizes).toHaveLength(1 + HEAVY.players);
      expectUnderCeilings(sizes);
      expect(dmBuildMs(b.s)).toBeLessThan(BUILD_MS);
    });

    test("CHARX §12 creature-sheet rows: DM all 16, each player only their own; ceilings hold", () => {
      const sizes = snapshotSizes(b.s);
      const sheets = sizes.map((v) => v.types[CREATURE_SHEET_TYPE]);
      expect(sheets.map((t) => t?.rows)).toEqual([HEAVY.sheets, 1, 1, 1, 1, 1, 1]);
      // Typical size (CHARX §12: 5–15 KB per sheet).
      const dm = sheets[0];
      const perSheet = (dm?.bytes ?? 0) / HEAVY.sheets;
      expect(perSheet).toBeGreaterThan(5_000);
      expect(perSheet).toBeLessThan(15_000);
      expectUnderCeilings(sizes);
    });

    test("SQL windows: providers return the window, not the history (build time flat)", () => {
      const before = dmBuildMs(b.s);
      const cid = b.s.db.$client
        .query<{ id: string }, []>("SELECT id FROM campaign WHERE active = 1")
        .get()?.id;
      const dm = { role: "dm" as const, playerId: null, campaignId: cid as string };
      for (let i = 0; i < 300; i++) {
        b.s.commands.run(
          "dice.roll",
          { expression: "1d20", mode: "normal", category: "damage" },
          { actor: dm },
        );
      }
      const v = { connId: "dm", campaignId: cid as string, role: "dm" as const, playerId: null };
      const src = { db: b.s.db, presence: { list: () => [] } };
      expect(b.s.records.get("game-log-entry")?.snapshot(src, v)).toHaveLength(GAME_LOG_WINDOW);
      expect(dmBuildMs(b.s)).toBeLessThan(Math.max(BUILD_MS, before * 2));
    });
  });
});
