// FR-MOD-55 `trigger-state` visibility over real sockets on the `rule-triggers` bundle (OQ-MOD-41
// pick A, #245; ADR-0049), rows written by MOD (S4-3): the fixture's Start / add wrote them; live
// changes come from real commands (player-1's Rage toggle, the DM's Next, an owner
// reassignment). The DM gets every row, a player only their own characters' rows, nobody but
// the DM a monster's. Leak scan per player over snapshots, events, `sync.load` acks and raw
// frames, before and after reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
} from "@shared/effect-modifiers/trigger-state";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { effectPreset, encounter, entity, player, triggerState } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { triggerStateVisibility } from "./trigger-state";

const DM = { role: "dm" as const, secret: TEST_SECRET };
/** After player-1's Rage and the DM's Next (round 1: the Wolf's turn → Brakka's). */
const LIVE_P1 = ["Divine Fury:armed:ready"];
const LIVE_P2 = ["Sneak Attack:armed:ready"];
const LIVE_DM = [
  ...LIVE_P1,
  "Martial Advantage:armed:ready",
  "Regeneration:armed:ready",
  ...LIVE_P2,
];
/** MOD §13.1 leak strings: monster triggers never reach a player frame. */
const MONSTER_LEAKS = ["Martial Advantage", "Regeneration"];

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const states = (c: TestClient) =>
  Object.values(c.store.records[TRIGGER_STATE_TYPE] ?? {}) as TriggerStateRecord[];
const summary = (c: TestClient) =>
  states(c)
    .map((r) => `${r.name}:${r.armed ? "armed" : "off"}:${r.charge}`)
    .sort();

describe("FR-MOD-55 trigger state over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let players: Record<string, { id: string; token: string }>;
  const p = (name: string) => ({ role: "player" as const, token: players[name]?.token as string });

  beforeAll(async () => {
    const loaded = await loadBundle("rule-triggers", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    players = Object.fromEntries(
      db
        .select({ name: player.name, id: player.id, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, { id: r.id, token: r.token }]),
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

  const scan = async (c: TestClient) => {
    await barrier(c);
    for (const leak of MONSTER_LEAKS) {
      expect({ leak, found: c.raw().includes(leak) }).toEqual({ leak, found: false });
    }
    expect(leakScan(h.s, c)).toEqual([]);
    const me = c.store.you?.playerId;
    for (const r of states(c)) {
      expect(r.characterId).not.toBeNull();
      expect(r.ownerPlayerId).toBe(me ?? "none");
    }
  };

  test("FR-MOD-55 badges per role: DM all rows; player-1 Brakka's; player-2 only Thorn's; no player a monster row", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // Written by the fixture's Start / add (round 1, the Wolf's turn): Divine Fury needs Rage and
    // Brakka's turn.
    expect(summary(dm)).toEqual([
      "Divine Fury:off:waiting",
      "Martial Advantage:armed:ready",
      "Regeneration:armed:ready",
      "Sneak Attack:armed:ready",
    ]);
    expect(summary(p1)).toEqual(["Divine Fury:off:waiting"]);
    expect(summary(p2)).toEqual(["Sneak Attack:armed:ready"]);
    await scan(p1);
    await scan(p2);
    // A `sync.load` of the triggers adds no state row and no monster trigger.
    for (const c of [p1, p2]) {
      c.load(RULE_TRIGGER_TYPE);
      await c.next("ack");
      await scan(c);
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-MOD-55 live: a change to Brakka's rows reaches the DM and player-1 only; a monster's the DM only; reassignment moves the rows; reconnect converges", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const brakka = db.select().from(entity).where(eq(entity.name, "Brakka")).get()?.id as string;
    const rage = db
      .select()
      .from(effectPreset)
      .where(and(eq(effectPreset.characterId, brakka), eq(effectPreset.name, "Rage")))
      .get()?.id as string;
    // player-1 rages (real `mod.toggle`, effect hooks → armed).
    p1.intent(MOD_INTENTS.toggle, { characterId: brakka, presetId: rage, on: true });
    await p1.next("ack");
    // The DM's Next: the Wolf's turn ends, charges move (Brakka's turn next).
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    dm.intent(CBT_INTENTS.nextTurn, {
      encounterId: enc?.id,
      expectedRound: enc?.round,
      expectedTurnId: enc?.turnCombatantId,
    });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(summary(dm)).toEqual(LIVE_DM);
    expect(summary(p1)).toEqual(LIVE_P1);
    expect(summary(p2)).toEqual(LIVE_P2);
    // A monster's row changes (the DM deletes Martial Advantage): the DM gets the delete only.
    const martial = db
      .select()
      .from(triggerState)
      .all()
      .find((r) => r.name === "Martial Advantage");
    dm.intent(TRIGGER_INTENTS.deleteTrigger, { triggerId: martial?.triggerId });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(summary(dm)).toEqual(LIVE_DM.filter((x) => !x.startsWith("Martial")));
    // player-2's frames never carried a row of Brakka's or a monster's.
    const p2Rows = () =>
      p2.frames.flatMap((f) =>
        f.type === "event" ? f.changes.filter((c) => c.type === TRIGGER_STATE_TYPE) : [],
      );
    expect(p2Rows()).toEqual([]);
    await scan(p1);
    await scan(p2);

    // Owner reassignment (FR-MOD-54's owner copy): Brakka's rows → player-2.
    dm.intent("char.edit", {
      creatureId: brakka,
      set: { ownerPlayerId: players["Player 2"]?.id },
    });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(summary(p1)).toEqual([]);
    expect(summary(p2)).toEqual([...LIVE_P1, ...LIVE_P2].sort());
    const lastP1 = p1.frames
      .flatMap((f) => (f.type === "event" ? f.changes : []))
      .filter((c) => c.type === TRIGGER_STATE_TYPE)
      .at(-1);
    expect(lastP1?.op).toBe("delete");
    await scan(p1);
    await scan(p2);

    // Reconnect: fresh snapshots equal the live stores; still no leak.
    for (const [c, cred] of [
      [p1, p("Player 1")],
      [p2, p("Player 2")],
      [dm, DM],
    ] as const) {
      const fresh = await h.live(cred);
      const r = convergence(h.s, c, fresh);
      expect(r.live[TRIGGER_STATE_TYPE] ?? {}).toEqual(r.fresh[TRIGGER_STATE_TYPE] ?? {});
      if (cred.role === "player") await scan(fresh);
      fresh.close();
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-MOD-55 visibility fn: owner full; another player, a monster row, an owner-less row hidden", () => {
    const row = db.select().from(triggerState).get();
    if (!row) throw new Error("no row");
    const v = (playerId: string) =>
      ({ connId: "c", campaignId: row.campaignId, role: "player", playerId }) as const;
    const pc = { ...row, characterId: "ch", ownerPlayerId: "p1" };
    expect(triggerStateVisibility(pc, v("p1"))).toBe("full");
    expect(triggerStateVisibility(pc, v("p2"))).toBe("hidden");
    expect(triggerStateVisibility({ ...pc, ownerPlayerId: null }, v("p1"))).toBe("hidden");
    expect(triggerStateVisibility({ ...pc, characterId: null, ownerPlayerId: null }, v("p1"))).toBe(
      "hidden",
    );
  });
});
