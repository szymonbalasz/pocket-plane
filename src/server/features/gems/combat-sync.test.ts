// GEM GM2 over real sockets on `gems` (Brakka: player-1, level 5, Combat 2, the Flame Tongue
// greatsword; DM, `player-1`, `player-2`): the Combat gem live for every connection; leak scan per
// player (frames, snapshot, fresh connection, reconnect): player-2 never gets player-1's card or
// its maxed dice, the DM-made card's detail never reaches a player; convergence.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { DamageCardPayload } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { GEM_SPEND_INTENT } from "@shared/gems/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { closeDb, type Db } from "../../db/client";
import { combatant, entity, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { convergence, leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let brakka: string;
let attackerId: string;
let attackId: string;

beforeAll(async () => {
  const loaded = await loadBundle("gems", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  const b = db
    .select()
    .from(entity)
    .all()
    .find((e) => e.name === "Brakka" && e.kind === "character");
  brakka = b?.id as string;
  const attacks = (b?.statBlock as { attacks: { id: string; name: string }[] }).attacks;
  attackId = attacks.find((a) => a.name.startsWith("Flame Tongue"))?.id as string;
  attackerId = db
    .select()
    .from(combatant)
    .all()
    .find((c) => c.entityId === brakka && !c.removed)?.id as string;
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

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const ok = async <R>(c: TestClient, name: string, payload: unknown) => {
  const f = await reply(c, name, payload);
  expect(f.type === "reject" ? JSON.stringify(f) : f.type).toBe("ack");
  return (f.type === "ack" ? f.result : null) as R;
};
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const card = (c: TestClient, id: string) =>
  recordsOf<NotificationRecord>(c.store, "notification").find((n) => n.id === id);
const payloadOf = (c: TestClient, id: string) => card(c, id)?.payload as DamageCardPayload;
const entry = (c: TestClient, id: string) =>
  recordsOf<GameLogEntryRecord>(c.store, "game-log-entry").find((e) => e.id === id);
const text = (e: GameLogEntryRecord | undefined) => (e ? lineText(formatEntry(e).segments) : null);
const flame = (c: TestClient) =>
  ok<{ cardId: string }>(c, "cbt.attack", {
    attackerId,
    attackId,
    manual: [{ diceTotal: 14 }, { diceTotal: 8, dice: [3, 5] }],
    manualExtra: [{ diceTotal: 8, dice: [2, 6] }],
  });

describe("gems Combat gem over real sockets (gems)", () => {
  test("FR-GEM-25 FR-GEM-29 FR-GEM-13 Combat gem live: P1 maxes Brakka's card; P2 never gets the card (frames, snapshot, fresh, reconnect); the DM-made card's detail stays the DM's; convergence", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    let p2 = await h.live(P2());
    const start = p2.frames.length;

    const { cardId } = await flame(p1);
    await until(() => [dm, p1].every((c) => card(c, cardId) !== undefined));
    const r = await ok<{ held: number; entryId: string }>(p1, GEM_SPEND_INTENT, {
      characterId: brakka,
      gem: "combat",
      cardId,
      dice: [{ part: "base", index: 0 }],
    });
    expect(r.held).toBe(1);
    await until(() => [dm, p1].every((c) => payloadOf(c, cardId)?.diceMaxed === true));
    await until(() => [dm, p1, p2].every((c) => entry(c, r.entryId) !== undefined));
    for (const c of [dm, p1]) {
      expect(payloadOf(c, cardId).damage?.maxed).toEqual([0]);
      expect(card(c, cardId)?.text).toContain("16 slashing + 8 fire");
    }
    for (const c of [dm, p1, p2]) {
      expect(text(entry(c, r.entryId))).toBe(
        "Brakka spends a Combat gem — Flame Tongue greatsword: slashing d6 3 → 6 (rolled 21 → 24)",
      );
    }
    // player-2: the public line only; never the card or its maxed dice.
    expect(card(p2, cardId)).toBeUndefined();
    const p2Frames = JSON.stringify(p2.frames.slice(start));
    expect(p2Frames).not.toContain('"diceMaxed"');
    expect(p2Frames).not.toContain('"maxed"');
    expect(leakScan(h.s, p2)).toEqual([]);

    // The DM rolls for Brakka (a DM-only card) and spends for him: players get no detail.
    const dmCard = await flame(dm);
    const s = await ok<{ entryId: string }>(dm, GEM_SPEND_INTENT, {
      characterId: brakka,
      gem: "combat",
      cardId: dmCard.cardId,
      dice: [{ part: 0, index: 0 }],
    });
    await until(() => [p1, p2].every((c) => entry(c, s.entryId) !== undefined));
    for (const c of [p1, p2]) {
      expect(text(entry(c, s.entryId))).toBe("Brakka spends a Combat gem");
      expect(card(c, dmCard.cardId)).toBeUndefined();
      expect(JSON.stringify(c.frames)).not.toContain(dmCard.cardId);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    await until(() => entry(dm, s.entryId) !== undefined);
    expect(text(entry(dm, s.entryId))).toBe(
      "Brakka spends a Combat gem — Flame Tongue greatsword: fire d6 2 → 6 (rolled 21 → 25)",
    );

    // Fresh connections and a reconnect converge with the live stores; still no card for P2.
    for (const c of [dm, p1, p2]) {
      const fresh = await h.live(c === dm ? DM : c === p1 ? P1() : P2());
      const { live, fresh: f } = convergence(h.s, c, fresh);
      expect(live).toEqual(f);
      fresh.close();
    }
    p2.close();
    p2 = await h.live(P2());
    expect(card(p2, cardId)).toBeUndefined();
    expect(JSON.stringify(p2.frames)).not.toContain('"diceMaxed"');
    expect(leakScan(h.s, p2)).toEqual([]);
    for (const c of [dm, p1, p2]) c.close();
  }, 60_000);
});
