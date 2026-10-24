// Stats Campaign tab over real sockets on the `stats-b` bundle (sprint 10 T3; DM, `player-1` =
// Mira, `player-2` = Thorn): FR-STATS-86 leak scan per player over the campaign ack (live, after
// reconnect, after a live hidden kill, after a hard restart: same numbers), the DM's numbers
// differ where hidden facts exist.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import type { Credential } from "@shared/protocol/frames";
import { CampaignResult, type CampaignStats, STATS_QUERY_INTENT } from "@shared/stats/schemas";
import { closeDb, type Db } from "../../db/client";
import { combatant, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { leaksIn } from "../combat-tracker/testing";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let combatants: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("stats-b", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  combatants = Object.fromEntries(
    db
      .select()
      .from(combatant)
      .all()
      .map((c) => [c.name, c.id]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const P1 = (): Credential => ({ role: "player", token: tokens["Player 1"] as string });
const P2 = (): Credential => ({ role: "player", token: tokens["Player 2"] as string });

/** Past the per-viewer rate window (FR-STATS-16, -69) between rounds. */
const RATE_WINDOW_MS = 1050;

async function result(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) {
      if (f.type !== "ack") throw new Error(JSON.stringify(f));
      return f.result;
    }
  }
}

/** The campaign answer, re-asked 1 s apart (as the client) while the partials build. */
async function campaign(c: TestClient): Promise<CampaignStats> {
  for (let i = 0; i < 10; i++) {
    const r = CampaignResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "campaign" }));
    if (!("pending" in r.campaign)) return r.campaign;
    await Bun.sleep(RATE_WINDOW_MS);
  }
  throw new Error("partials never ready");
}

/**
 * What a player's campaign ack must never hold (FR-STATS-05, -47, -86): hidden monsters, encounter
 * names, HP / overkill / Effective fields, hidden marks, special rows, the DM's dice row.
 */
const LEAKS = [
  "Elite Goblin Warrior",
  "Bandit Captain",
  '"Goblin 2"',
  '"Wolf"',
  "Ambush at the Ford",
  "Old Crypt",
  '"hidden"',
  '"downs"',
  '"effective"',
  "hpBefore",
  "hpAfter",
  '"applied"',
  '"overkill"',
  "DM (direct)",
  "Unattributed",
  '"monster"',
  "dm-dice",
  "DM dice",
];

const acks = (c: TestClient) => JSON.stringify(c.frames.filter((f) => f.type === "ack"));
const row = (c: CampaignStats, name: string) => c.rows.find((r) => r.name === name);

describe("stats Campaign tab over real sockets (stats-b)", () => {
  test("FR-STATS-86 leak scan per player: the campaign ack live, after reconnect, after a hidden kill and after a hard restart", async () => {
    await Bun.sleep(RATE_WINDOW_MS);
    const dm = await h.live(DM);
    const dmFirst = await campaign(dm);
    // The DM counts the hidden Captain / Goblin 2 kills, the Elite's hit and the hidden nat 20s.
    expect([dmFirst.slain, row(dmFirst, "Thorn")?.kills, row(dmFirst, "Thorn")?.taken]).toEqual([
      9, 4, 209,
    ]);
    expect(dmFirst.records["biggest-hit"]?.fight).toContain("Old Crypt");
    const first: Record<string, CampaignStats> = {};
    for (const [name, cred] of [
      ["Player 1", P1],
      ["Player 2", P2],
    ] as const) {
      const c = await h.live(cred());
      const answer = await campaign(c);
      expect(leaksIn(acks(c), LEAKS)).toEqual([]);
      expect([answer.slain, row(answer, "Thorn")?.kills, row(answer, "Thorn")?.taken]).toEqual([
        7, 3, 200,
      ]);
      first[name] = answer;
      c.close();
      await Bun.sleep(RATE_WINDOW_MS);
      // Reconnect: the same answer, still clean.
      const again = await h.live(cred());
      expect(await campaign(again)).toEqual(answer);
      expect(leaksIn(acks(again), LEAKS)).toEqual([]);
      again.close();
      await Bun.sleep(RATE_WINDOW_MS);
    }
    expect(first["Player 1"]).toEqual(first["Player 2"] as CampaignStats);

    // A live kill of the hidden Elite by Thorn: the DM's numbers move, the players' don't.
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants["Elite Goblin Warrior"],
      kind: "damage",
      amount: 30,
      public: true,
      sourceId: combatants.Thorn,
    });
    await Bun.sleep(RATE_WINDOW_MS);
    const dmAfter = await campaign(dm);
    expect([dmAfter.slain, row(dmAfter, "Thorn")?.dealt]).toEqual([
      10,
      (row(dmFirst, "Thorn")?.dealt as number) + 30,
    ]);
    for (const cred of [P1, P2]) {
      const c = await h.live(cred());
      expect(await campaign(c)).toEqual(first["Player 1"] as CampaignStats);
      expect(leaksIn(acks(c), LEAKS)).toEqual([]);
      c.close();
    }
    dm.close();

    // Hard kill → the same numbers: nothing stored; the restart rebuilds the partials.
    await h.restart();
    await Bun.sleep(RATE_WINDOW_MS);
    const after = await h.live(P2());
    expect(await campaign(after)).toEqual(first["Player 1"] as CampaignStats);
    expect(leaksIn(acks(after), LEAKS)).toEqual([]);
    after.close();
    const dmAgain = await h.live(DM);
    expect(await campaign(dmAgain)).toEqual(dmAfter);
    dmAgain.close();
  }, 60_000);
});
