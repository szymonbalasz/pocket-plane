// DICEX §13 integration over real sockets on the `dice-extras` bundle: every snapshot frame (DM,
// player-1, player-2) carries every `dice-look` row (FR-DICEX-25); `dicex.setLook` reaches every
// client of the campaign as one upsert (FR-DICEX-26); per-player leak scans (hidden roll
// "DM-SECRET-ROLL" of rolls-1, the second campaign's looks) over snapshots and event frames,
// before and after a reconnect; a restart on the same DB gives identical snapshots.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { DICEX_LOOKS } from "@fixtures/units/dice-extras/dicex-looks";
import { SECRET_LABEL } from "@fixtures/units/dice-roll-log/rolls-1";
import {
  DICEX_INTENTS as D,
  DICE_LOOK_TYPE,
  type DiceLookRecord,
  lookOf,
  STYLE_LOOK,
} from "@shared/dice-extras/looks";
import { DiceLookSet } from "@shared/events/dice-extras";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, diceLook, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
/** A look only the second campaign holds: must never reach this campaign's clients. */
const SECOND_LOOK = { style: "bone", body: "#0a0b0c", pips: "#c0ffee", material: "stone" };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const looks = (c: TestClient) =>
  Object.values(c.store.records[DICE_LOOK_TYPE] ?? {}) as DiceLookRecord[];
const snapshotOf = (c: TestClient) => {
  const f = [...c.frames].reverse().find((x) => x.type === "snapshot");
  if (f?.type !== "snapshot") throw new Error("no snapshot");
  return f;
};
const lookEvents = (c: TestClient, from = 0) =>
  c.frames
    .slice(from)
    .filter(
      (f): f is Extract<ServerFrame, { type: "event" }> =>
        f.type === "event" && f.cause.name === DiceLookSet.type,
    );

describe("DICEX §13 dice looks over sockets (dice-extras bundle)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ids: Record<string, string>;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const forbidden = [SECRET_LABEL, SECOND_LOOK.body, SECOND_LOOK.pips];
  const expectClean = (c: TestClient, label: string) => {
    const raw = c.raw();
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };

  beforeAll(async () => {
    const loaded = await loadBundle("dice-extras", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const active = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.active)?.id;
    const players = db
      .select()
      .from(player)
      .all()
      .filter((p) => p.campaignId === active);
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    ids = Object.fromEntries(players.map((r) => [r.name, r.id]));
    // The second campaign's DM look, written straight to the table (no fixture unit needs it).
    const second = db
      .select()
      .from(campaign)
      .all()
      .find((c) => !c.active);
    if (second) {
      db.insert(diceLook)
        .values({
          id: "second-dm-look",
          campaignId: second.id,
          ownerKey: "dm",
          ownerPlayerId: null,
          ...SECOND_LOOK,
          style: "bone",
          material: "stone",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })
        .run();
    }
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-DICEX-25 every snapshot frame carries every dice-look row; no leak per player", () => {
    const rows = snapshotOf(dm).records[DICE_LOOK_TYPE] as DiceLookRecord[];
    expect(rows).toHaveLength(2);
    for (const c of [p1, p2]) expect(snapshotOf(c).records[DICE_LOOK_TYPE]).toEqual(rows);
    const playerIds = Object.values(ids);
    for (const c of [dm, p1, p2]) {
      expect(lookOf(null, looks(c), playerIds)).toEqual(DICEX_LOOKS.dm);
      expect(lookOf(ids["Player 1"] as string, looks(c), playerIds)).toEqual(DICEX_LOOKS.player1);
      expect(lookOf(ids["Player 2"] as string, looks(c), playerIds).style).toBe("sapphire");
    }
    expectClean(p1, "p1 snapshot");
    expectClean(p2, "p2 snapshot");
    expect(leakScan(h.s, dm)).toEqual([]);
  });

  test("FR-DICEX-26 player-2 saves Emerald glass: one upsert to DM, player-1 and player-2; same look → no event", async () => {
    const marks = [dm, p1, p2].map((c) => c.frames.length);
    const a = await answer(p2, p2.intent(D.setLook, STYLE_LOOK.emerald));
    expect(a.type).toBe("ack");
    const lookId = (a as { result?: { lookId: string } }).result?.lookId as string;
    expect(lookId).toBeString();
    for (const [i, c] of [dm, p1, p2].entries()) {
      await until(() => lookEvents(c, marks[i]).length === 1);
      const ev = lookEvents(c, marks[i])[0];
      expect(ev?.changes).toEqual([
        {
          type: DICE_LOOK_TYPE,
          id: lookId,
          op: "upsert",
          data: expect.objectContaining({
            ownerKey: ids["Player 2"],
            ...STYLE_LOOK.emerald,
          }),
        },
      ]);
      expect(lookOf(ids["Player 2"] as string, looks(c), Object.values(ids))).toEqual(
        STYLE_LOOK.emerald,
      );
    }
    const quiet = dm.frames.length;
    const again = await answer(p2, p2.intent(D.setLook, STYLE_LOOK.emerald));
    expect(again).toMatchObject({ type: "ack", result: { lookId } });
    await Bun.sleep(100);
    expect(lookEvents(dm, quiet)).toEqual([]);
    // No owner field: a player can't name another owner.
    const bad = await answer(
      p2,
      p2.intent(D.setLook, { ...STYLE_LOOK.gold, ownerPlayerId: ids["Player 1"] }),
    );
    expect(bad).toMatchObject({ type: "reject", code: "invalid" });
    expect(lookOf(ids["Player 1"] as string, looks(dm), Object.values(ids))).toEqual(
      DICEX_LOOKS.player1,
    );
    expectClean(p1, "p1 after set");
    expectClean(p2, "p2 after set");
  });

  test("FR-DICEX-25 before and after a reconnect: same rows, converged, nothing leaked", async () => {
    for (const name of ["Player 1", "Player 2"] as const) {
      const old = name === "Player 1" ? p1 : p2;
      old.close();
      await old.closed;
      const fresh = await h.live(cred(name));
      expect(looks(fresh).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        looks(dm).sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(looks(fresh)).toHaveLength(3);
      expectClean(fresh, `${name} after reconnect`);
      const again = await h.live(cred(name));
      const { live, fresh: f } = convergence(h.s, fresh, again);
      expect(live).toEqual(f);
      again.close();
      if (name === "Player 1") p1 = fresh;
      else p2 = fresh;
    }
  });

  test("DICEX §11 restart on the same DB: identical dice-look snapshots for DM and players", async () => {
    const before = [dm, p1, p2].map((c) => snapshotOf(c).records[DICE_LOOK_TYPE]);
    await h.restart();
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    const after = [dm, p1, p2].map((c) => snapshotOf(c).records[DICE_LOOK_TYPE]);
    // The DM's snapshot before the restart predates player-2's save; compare with the stores.
    expect(after[0]).toEqual(after[1]);
    expect(after[1]).toEqual(after[2]);
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expectClean(p1, "p1 after restart");
    expectClean(p2, "p2 after restart");
  });
});
