// Sprint 6 CP3 over real sockets on `companions` (CBT §13.3 "Leak scan per player"): a summon for
// Mira, a hidden summon for Thorn, Thorn's concentration ending (the DM's card), the owner's
// Dismiss, Turn hostile from the card, then End. Each player's store, acks and raw frames pass the
// leak scan (a hidden summon reaches no player, the owner included; another's summon is a band;
// DM-only fields and the card never reach players) and, after a reconnect, live = fresh
// (FR-SYNC-20).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { SUMMON_CARD_KIND } from "@shared/combat-tracker/summon-card-kind";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
/** Sends and waits for this intent's ack (other frames stay in `frames`). */
async function ack(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) {
      if (f.type === "reject") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
      return f.result;
    }
  }
}
const rows = (c: TestClient) =>
  Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as (CombatantRecord &
    Record<string, unknown>)[];
const byName = (c: TestClient, name: string) => rows(c).find((x) => x.name === name);

describe("CP3 summons over WS (companions)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("companions", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    h = await startTestServer({ db, fake: false });
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

  test("FR-CBT-116 leak scan per player: summon, hidden summon, concentration card, owner Dismiss, Turn hostile, End; live = fresh after reconnect", async () => {
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    // Players hold the battle scene's tokens only while it is active.
    h.s.commands.run(
      "map.activateScene",
      { sceneId: enc?.sceneId },
      { actor: { role: "dm", playerId: null, campaignId: enc?.campaignId as string } },
    );
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const fe = byName(dm, "Fire Elemental") as CombatantRecord;
    const fe3 = byName(dm, "Fire Elemental 3") as CombatantRecord;
    const mira = byName(dm, "Mira") as CombatantRecord;
    const thorn = byName(dm, "Thorn") as CombatantRecord;

    // A second Fire Elemental for Mira (visible), one hidden for Thorn.
    const { combatantIds: shown } = (await ack(dm, "cbt.summon", {
      encounterId: enc?.id,
      definitionId: fe.entityId,
      count: 1,
      ownerCharacterId: mira.entityId,
    })) as { combatantIds: string[] };
    const { combatantIds: hidden } = (await ack(dm, "cbt.summon", {
      encounterId: enc?.id,
      definitionId: fe.entityId,
      count: 1,
      ownerCharacterId: thorn.entityId,
      hidden: true,
    })) as { combatantIds: string[] };
    for (const c of [p1, p2]) await barrier(c);
    // player-1 owns the new one: HP and card; player-2 a band; nobody holds the hidden one.
    const newFe = shown[0] as string;
    expect(p1.store.records[COMBATANT_TYPE]?.[newFe]).toMatchObject({ hpCurrent: 102 });
    const p2View = p2.store.records[COMBATANT_TYPE]?.[newFe] as Record<string, unknown>;
    expect(p2View).toMatchObject({ band: "healthy", ownerCharacterId: mira.entityId });
    expect("card" in p2View || "hpCurrent" in p2View).toBe(false);
    for (const c of [p1, p2]) {
      expect(c.store.records[COMBATANT_TYPE]?.[hidden[0] as string]).toBeUndefined();
    }

    // Thorn's concentration ends (the DM ends it): the DM's card; players get nothing of it.
    const conc = (Object.values(dm.store.records[EFFECT_TYPE] ?? {}) as EffectRecord[]).find(
      (e) => e.id === fe3.concentrationEffectId,
    ) as EffectRecord;
    await ack(dm, "cbtx.endEffect", { effectId: conc.id });
    await barrier(dm);
    const card = (Object.values(dm.store.records.notification ?? {}) as NotificationRecord[]).find(
      (n) => n.kind === SUMMON_CARD_KIND,
    );
    expect(card).toMatchObject({ state: "pending", audience: "dm" });

    // player-1 dismisses their new summon; the DM turns FE 3 hostile from the card's button.
    await ack(p1, "cbt.dismiss", { combatantId: newFe });
    await ack(dm, "cbt.setCompanion", { combatantId: fe3.id, owner: null, side: "enemy" });
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(dm.store.records.notification?.[card?.id as string]).toMatchObject({
      state: "resolved",
      resolution: { outcome: "hostile" },
    });
    for (const c of [p1, p2]) expect(c.store.records[COMBATANT_TYPE]?.[newFe]).toBeUndefined();
    expect(byName(p2, "Fire Elemental 3")).toMatchObject({ side: "enemy" });
    expect("card" in (byName(p2, "Fire Elemental 3") ?? {})).toBe(false);

    // Leak scan: stores + acks, then the raw bytes.
    for (const c of [dm, p1, p2]) expect(leakScan(h.s, c)).toEqual([]);
    for (const c of [p1, p2]) {
      const raw = c.raw();
      for (const leak of [
        hidden[0] as string,
        SUMMON_CARD_KIND,
        card?.id as string,
        "concentrationEffectId",
        "ownerHidden",
        '"summoned"',
        "lost concentration",
      ]) {
        expect({ leak, found: raw.includes(leak) }).toEqual({ leak, found: false });
      }
    }

    // FR-SYNC-20: a reconnect gets what the live stores hold.
    for (const [live, cred] of [
      [dm, DM],
      [p1, p("Player 1")],
      [p2, p("Player 2")],
    ] as const) {
      const fresh = await h.live(cred);
      const conv = convergence(h.s, live, fresh);
      // The snapshot carries active effects only (CBTX, CON-44); an ended one a live client
      // still holds is real, just not resent.
      const effects = Object.fromEntries(
        Object.entries(conv.live[EFFECT_TYPE] ?? {}).filter(
          ([, e]) => !(e as Partial<EffectRecord>).endedAt,
        ),
      );
      expect({ ...conv.live, [EFFECT_TYPE]: effects }).toEqual({
        ...conv.fresh,
        [EFFECT_TYPE]: conv.fresh[EFFECT_TYPE] ?? {},
      });
    }

    // End: the summons' tokens go, players get the deletes; still no leak.
    await ack(dm, "cbt.end", { encounterId: enc?.id });
    for (const c of [p1, p2]) await barrier(c);
    for (const c of [p1, p2]) {
      expect(leakScan(h.s, c)).toEqual([]);
      expect(c.raw()).not.toContain(hidden[0] as string);
    }
  }, 60_000);
});
