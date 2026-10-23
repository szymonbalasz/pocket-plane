// Session recap over real sockets on `sp-s9` (DM, `player-1` = Mira, `player-2` = Thorn):
// FR-RECAP-08 / FR-STATS-80 leak scan per player over recap acks (live, after reconnect, after a
// hard restart: the same recap, `state:digest` equal), FR-RECAP-21 a share reaches every client
// with a player-safe payload and the players' recap carries its note.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import {
  DmRecapResult,
  PlayerRecapResult,
  RECAP_QUERY_INTENT,
  RECAP_SHARE_INTENT,
  SESSION_RECAP_KIND,
  SessionRecapPayload,
} from "@shared/session-recap/schemas";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { combatant, encounter, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { leaksIn } from "../combat-tracker/testing";
import { NOTIFICATION_TYPE } from "../notifications/helpers";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let leaks: string[];

beforeAll(async () => {
  const loaded = await loadBundle("sp-s9", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  // Hidden combatants whose name no visible one shares, and every encounter name.
  const all = db.select().from(combatant).all();
  const shown = new Set(all.filter((c) => !c.hidden).map((c) => c.name));
  const hidden = [...new Set(all.filter((c) => c.hidden && !shown.has(c.name)).map((c) => c.name))];
  const encounters = db
    .select()
    .from(encounter)
    .all()
    .map((e) => `"label":"${e.name}"`);
  leaks = [
    ...hidden.map((n) => `"${n}"`),
    ...encounters,
    '"hidden"',
    '"standing"',
    '"overkill"',
    '"downs"',
    '"effective"',
    "hpBefore",
    "hpAfter",
    '"applied"',
    "targetAc",
    "dm-dice",
    "DM dice",
  ];
  h = await startTestServer({ db, testMode: true, fake: false });
}, 120_000);

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

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 5000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function result(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(JSON.stringify(f));
  return f.result;
}
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const ackText = (frames: readonly ServerFrame[]) =>
  JSON.stringify(frames.filter((f) => f.type === "ack"));
const playerRecap = async (c: TestClient) =>
  PlayerRecapResult.parse(await result(c, RECAP_QUERY_INTENT, {})).recap;

describe("session recap over real sockets (sp-s9)", () => {
  test("FR-RECAP-08 FR-STATS-80 leak scan per player: recap acks live, after reconnect and after a hard restart (state:digest equal)", async () => {
    const dm = await h.live(DM);
    const dmRecap = DmRecapResult.parse(await result(dm, RECAP_QUERY_INTENT, {})).recap;
    const dmText = JSON.stringify(dmRecap);
    expect(dmText).toContain("Bandit Captain");
    expect(dmText).toContain('"standing"');
    expect(dmRecap?.fights.map((f) => f.label)).toContain("Bandit Camp");
    expect(dmRecap?.loot.rows.map((r) => r.text)).toContain("Bandit Camp strongbox");
    dm.close();
    const first: Record<string, unknown> = {};
    for (const [name, cred] of [
      ["Player 1", P1],
      ["Player 2", P2],
    ] as const) {
      const c = await h.live(cred());
      const r = await playerRecap(c);
      expect(r?.fights.every((f) => /^Fight \d+ · /.test(f.label))).toBe(true);
      expect(r?.loot).toEqual(dmRecap?.loot);
      expect(leaksIn(ackText(c.frames), leaks)).toEqual([]);
      first[name] = r;
      c.close();
      const again = await h.live(cred());
      expect(await playerRecap(again)).toEqual(r);
      expect(leaksIn(ackText(again.frames), leaks)).toEqual([]);
      again.close();
    }
    // FR-RECAP-03: every player gets the same recap.
    expect(first["Player 1"]).toEqual(first["Player 2"]);
    // Hard kill → the same recap; nothing was written.
    const digest = stateDigest(db.$client).sha256;
    await h.restart();
    expect(stateDigest(db.$client).sha256).toBe(digest);
    const after = await h.live(P1());
    expect(await playerRecap(after)).toEqual(first["Player 1"] as never);
    expect(leaksIn(ackText(after.frames), leaks)).toEqual([]);
    after.close();
  }, 60_000);

  test("FR-RECAP-21 a share reaches the DM and every player, payload player-safe; players' recap carries the note, Notable rolls left out", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const dmRecap = DmRecapResult.parse(await result(dm, RECAP_QUERY_INTENT, {})).recap;
    const fromN = dmRecap?.fromN as number;
    await result(dm, RECAP_SHARE_INTENT, {
      fromN,
      note: "Cleared the Bandit Camp",
      omit: ["rolls"],
    });
    const shareOf = (c: TestClient) =>
      recordsOf<NotificationRecord>(c.store, NOTIFICATION_TYPE).filter(
        (n) => n.kind === SESSION_RECAP_KIND,
      );
    for (const c of [dm, p1, p2]) {
      await until(() => shareOf(c).length > 0);
      const n = shareOf(c)[0];
      expect(n).toMatchObject({ audience: "all", state: "info" });
      expect(SessionRecapPayload.parse(n?.payload)).toMatchObject({
        fromN,
        note: "Cleared the Bandit Camp",
        omit: ["rolls"],
      });
      expect(leaksIn(JSON.stringify(n), leaks)).toEqual([]);
    }
    for (const c of [p1, p2]) {
      const r = await playerRecap(c);
      expect(r?.shared?.note).toBe("Cleared the Bandit Camp");
      expect(r?.rolls).toBeUndefined();
    }
    const again = DmRecapResult.parse(await result(dm, RECAP_QUERY_INTENT, {})).recap;
    expect(again?.shared?.omit).toEqual(["rolls"]);
    expect(again?.rolls.rows.length).toBeGreaterThan(0);
    // A player's share → forbidden.
    const r = await reply(p1, RECAP_SHARE_INTENT, { fromN });
    expect(r.type === "reject" && r.code).toBe("forbidden");
    for (const c of [dm, p1, p2]) c.close();
  }, 30_000);
});
