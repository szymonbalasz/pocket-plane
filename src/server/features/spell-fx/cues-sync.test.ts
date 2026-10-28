// VFX §13 Integration over real sockets on bundle `spell-fx` (DM, `player-1`, `player-2`): hit cue
// routing per connection (FR-VFX-21), plays-nothing cases (FR-VFX-20), no queue / replay on
// reconnect and never in a snapshot (FR-VFX-22), the BL-135 roll guard's DM-only line.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { type HitCue, VFX_HIT_SIGNAL } from "@shared/spell-fx/cue";
import { eq } from "drizzle-orm";
import { closeDb, type Db } from "../../db/client";
import { player, token } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { damageRollIdOf, partRollIdsFor } from "../combat-tracker/testing";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let links: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("spell-fx", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  links = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
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
const P = (name: string): Credential => ({ role: "player", token: links[name] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function ok(c: TestClient, name: string, payload: unknown) {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result;
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const cuesOf = (c: TestClient) =>
  c.frames
    .filter((f): f is Extract<ServerFrame, { type: "signal" }> => f.type === "signal")
    .filter((f) => f.name === VFX_HIT_SIGNAL)
    .map((f) => f.data as HitCue);

async function table() {
  const dm = await h.live(DM);
  const p1 = await h.live(P("Player 1"));
  const p2 = await h.live(P("Player 2"));
  const fighter = (name: string) =>
    (Object.values(dm.store.records.combatant ?? {}) as CombatantRecord[]).find(
      (x) => x.name === name && x.active,
    ) as CombatantRecord;
  /** Every client's cues since now, after a barrier per client. */
  const mark = () => [dm, p1, p2].map((c) => cuesOf(c).length);
  const since = async (m: number[]) => {
    for (const c of [dm, p1, p2]) await barrier(c);
    const out = [dm, p1, p2].map((c, i) => cuesOf(c).slice(m[i]));
    return out as [HitCue[], HitCue[], HitCue[]];
  };
  const close = () => {
    for (const c of [dm, p1, p2]) c.close();
  };
  return { dm, p1, p2, fighter, mark, since, close };
}

/** FR-FOG-11 seam: the token fogged for every player but `seenBy` (party vision copy). */
function fogFor(tokenId: string, seenBy: string[]) {
  db.update(token).set({ fogged: true, seenBy }).where(eq(token.id, tokenId)).run();
}
function unfog(tokenId: string, all: string[]) {
  db.update(token).set({ fogged: false, seenBy: all }).where(eq(token.id, tokenId)).run();
}
const pid = (name: string) =>
  db.select().from(player).where(eq(player.name, name)).get()?.id as string;

describe("hit cues (FR-VFX-20–22)", () => {
  test("FR-VFX-21 the fire card on a visible goblin → one cue to all three, aimed from Mira", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    const mira = t.fighter("Mira");
    const card = Object.values(t.dm.store.records.notification ?? {}).find(
      (n) => (n as { kind: string; state: string }).kind === "damage-card",
    ) as { id: string; payload: { toHit: { total: number } } };
    const m = t.mark();
    const r = (await ok(t.dm, "cbt.applyCard", {
      cardId: card.id,
      toHitTotal: card.payload.toHit.total,
      damageTotal: 7,
      damageRollId: damageRollIdOf(card),
      partRollIds: partRollIdsFor(card),
      targets: [{ targetId: sneak.id, hit: true, multiplier: "normal" }],
    })) as { hpChangeIds: string[] };
    const [dm, p1, p2] = await t.since(m);
    const want: HitCue = {
      id: r.hpChangeIds[0] as string,
      targetTokenId: sneak.tokenId as string,
      attackerTokenId: mira.tokenId as string,
      kind: "damage",
      parts: [{ type: "fire", value: 7 }],
      multiplier: "normal",
      crit: false,
    };
    expect(dm).toEqual([want]);
    expect(p1).toEqual([want]);
    expect(p2).toEqual([want]);
    t.close();
  });

  test("FR-VFX-21 hidden goblin → DM only; players' frames carry no cue (leak)", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    await ok(t.dm, "map.setTokenHidden", { tokenId: sneak.tokenId, hidden: true });
    const m = t.mark();
    const r = (await ok(t.dm, "cbt.applyHp", {
      combatantId: sneak.id,
      kind: "damage",
      amount: 4,
      public: true,
    })) as { hpChangeId: string };
    const [dm, p1, p2] = await t.since(m);
    expect(dm).toEqual([
      {
        id: r.hpChangeId,
        targetTokenId: sneak.tokenId as string,
        kind: "damage",
        parts: [{ type: null, value: 4 }],
        multiplier: "normal",
        crit: false,
      },
    ]);
    expect(p1).toEqual([]);
    expect(p2).toEqual([]);
    for (const c of [t.p1, t.p2]) expect(c.raw()).not.toContain(r.hpChangeId);
    await ok(t.dm, "map.setTokenHidden", { tokenId: sneak.tokenId, hidden: false });
    t.close();
  });

  test("FR-VFX-21 fogged for player-2 only → DM and player-1; never player-2", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    fogFor(sneak.tokenId as string, [pid("Player 1")]);
    const m = t.mark();
    await ok(t.dm, "cbt.applyHp", {
      combatantId: sneak.id,
      kind: "damage",
      amount: 3,
      public: true,
    });
    const [dm, p1, p2] = await t.since(m);
    expect(dm).toHaveLength(1);
    expect(p1).toEqual(dm);
    expect(p2).toEqual([]);
    unfog(sneak.tokenId as string, [pid("Player 1"), pid("Player 2")]);
    t.close();
  });

  test("FR-VFX-21 attacker token not received → no attackerTokenId for that player", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    const thorn = t.fighter("Thorn");
    fogFor(sneak.tokenId as string, [pid("Player 1")]);
    const m = t.mark();
    await ok(t.dm, "cbt.applyHp", {
      combatantId: thorn.id,
      kind: "damage",
      amount: 5,
      public: true,
      sourceId: sneak.id,
    });
    const [dm, p1, p2] = await t.since(m);
    expect(dm[0]?.attackerTokenId).toBe(sneak.tokenId as string);
    expect(p1[0]?.attackerTokenId).toBe(sneak.tokenId as string);
    expect(p2).toHaveLength(1);
    expect(p2[0]).not.toHaveProperty("attackerTokenId");
    expect(p2[0]?.targetTokenId).toBe(thorn.tokenId as string);
    unfog(sneak.tokenId as string, [pid("Player 1"), pid("Player 2")]);
    t.close();
  });

  test("FR-VFX-21 DM-only outcome line → DM only (a private apply; BL-135: a renamed goblin's roll)", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    const thorn = t.fighter("Thorn");
    let m = t.mark();
    await ok(t.dm, "cbt.applyHp", {
      combatantId: sneak.id,
      kind: "damage",
      amount: 2,
      public: false,
    });
    let [dm, p1, p2] = await t.since(m);
    expect(dm).toHaveLength(1);
    expect([...p1, ...p2]).toEqual([]);
    // "Goblin Sneak" isn't its definition's name: the roll guard keeps its attack DM-only.
    const { cardId } = (await ok(t.dm, "cbt.attack", {
      attackerId: sneak.id,
      manual: [{ diceTotal: 18 }, { diceTotal: 4 }],
      public: undefined,
    })) as { cardId: string };
    await barrier(t.dm);
    const card = t.dm.store.records.notification?.[cardId];
    m = t.mark();
    await ok(t.dm, "cbt.applyCard", {
      cardId,
      toHitTotal: 22,
      damageTotal: 6,
      damageRollId: damageRollIdOf(card),
      partRollIds: partRollIdsFor(card),
      targets: [{ targetId: thorn.id, hit: true, multiplier: "half" }],
      public: true,
    });
    [dm, p1, p2] = await t.since(m);
    expect(dm).toHaveLength(1);
    expect(dm[0]).toMatchObject({
      targetTokenId: thorn.tokenId as string,
      attackerTokenId: sneak.tokenId as string,
      multiplier: "half",
      parts: [{ type: "slashing", value: 3 }],
    });
    expect([...p1, ...p2]).toEqual([]);
    t.close();
  });

  test("FR-VFX-20 a miss and an undo play nothing; a heal cues `heal`", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    const thorn = t.fighter("Thorn");
    const { cardId } = (await ok(t.dm, "cbt.attack", {
      attackerId: sneak.id,
      manual: [{ diceTotal: 2 }, { diceTotal: 4 }],
    })) as { cardId: string };
    await barrier(t.dm);
    const card = t.dm.store.records.notification?.[cardId];
    let m = t.mark();
    await ok(t.dm, "cbt.applyCard", {
      cardId,
      toHitTotal: 6,
      damageTotal: 6,
      damageRollId: damageRollIdOf(card),
      partRollIds: partRollIdsFor(card),
      targets: [{ targetId: thorn.id, hit: false, multiplier: "normal" }],
    });
    let got = await t.since(m);
    expect(got.flat()).toEqual([]);
    const r = (await ok(t.dm, "cbt.applyHp", {
      combatantId: thorn.id,
      kind: "heal",
      amount: 3,
      public: true,
    })) as { hpChangeId: string };
    m = t.mark();
    await ok(t.dm, "cbt.undo", { expectedHpChangeId: r.hpChangeId });
    got = await t.since(m);
    expect(got.flat()).toEqual([]);
    m = t.mark();
    await ok(t.dm, "cbt.applyHp", { combatantId: thorn.id, kind: "heal", amount: 2, public: true });
    got = await t.since(m);
    for (const list of got) {
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ kind: "heal", parts: [{ type: null, value: 2 }] });
      expect(list[0]).not.toHaveProperty("attackerTokenId");
    }
    t.close();
  });

  test("FR-VFX-22 cues are never queued or replayed: offline player gets none; no cue in a snapshot", async () => {
    const t = await table();
    const sneak = t.fighter("Goblin Sneak");
    t.p2.close();
    await t.p2.closed;
    await ok(t.dm, "cbt.applyHp", {
      combatantId: sneak.id,
      kind: "damage",
      amount: 1,
      public: true,
    });
    const back = await h.live(P("Player 2"));
    await barrier(back);
    expect(cuesOf(back)).toEqual([]);
    const snap = back.frames.find((f) => f.type === "snapshot");
    expect(JSON.stringify(snap)).not.toContain(VFX_HIT_SIGNAL);
    // A resync (fresh snapshot) carries none either.
    back.send({ type: "resync" });
    await back.next("snapshot");
    await barrier(back);
    expect(cuesOf(back)).toEqual([]);
    back.close();
    t.close();
  });
});
