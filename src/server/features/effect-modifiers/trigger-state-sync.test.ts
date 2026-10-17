// FR-MOD-55 `trigger-state` visibility over real sockets on the `rule-triggers` bundle (OQ-MOD-41
// pick A, #245; ADR-0049): the DM gets every row, a player only their own characters' rows,
// nobody but the DM a monster's. Rows are written straight to the table (MOD's writes come in
// S4-3); live changes ride on a stand-in effect hook line (the seam S4-3's line uses), incl. an
// owner reassignment (old owner: delete, new owner: upsert). Leak scan per player over
// snapshots, events, `sync.load` acks and raw frames, before and after reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
} from "@shared/effect-modifiers/trigger-state";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { combatant, encounter, entity, player, ruleTrigger, triggerState } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { effectsChangedHooks } from "../combat-extras/effect-hooks";
import { triggerStateChange, triggerStateVisibility } from "./trigger-state";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const AT = "2026-01-01T00:00:00.000Z";
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
    .map((r) => `${r.name}:${r.armed ? "armed" : "off"}`)
    .sort();

/** A stand-in for S4-3's line: flips `armed` on the changed creatures' rows (+ an owner move). */
let reassignTo: string | null = null;
const LINE = "test.trigger-state-line";
function standInLine(env: { tx: Db; ctx: { clock: { iso(): string } } }, creatures: unknown[]) {
  const changes: RecordChange[] = [];
  for (const ref of creatures as ({ combatantId: string } | { characterId: string })[]) {
    const rows = env.tx
      .select()
      .from(triggerState)
      .where(
        "combatantId" in ref
          ? eq(triggerState.combatantId, ref.combatantId)
          : eq(triggerState.characterId, ref.characterId),
      )
      .all();
    for (const before of rows) {
      env.tx
        .update(triggerState)
        .set({
          armed: !before.armed,
          ...(reassignTo && before.characterId ? { ownerPlayerId: reassignTo } : {}),
          updatedAt: env.ctx.clock.iso(),
        })
        .where(eq(triggerState.id, before.id))
        .run();
      const after = env.tx.select().from(triggerState).where(eq(triggerState.id, before.id)).get();
      changes.push(triggerStateChange(before, after ?? null));
    }
  }
  return changes;
}

describe("FR-MOD-55 trigger state over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let players: Record<string, { id: string; token: string }>;
  let ids: Record<string, string>;
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
    // One row per (enabled trigger, owner combatant) of the started encounter (FR-MOD-53).
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    if (!enc) throw new Error("no started encounter");
    const fighters = db
      .select()
      .from(combatant)
      .where(and(eq(combatant.encounterId, enc.id), eq(combatant.active, true)))
      .all();
    const triggers = db.select().from(ruleTrigger).all();
    ids = {};
    let n = 0;
    for (const k of fighters) {
      for (const t of triggers) {
        const own = k.kind === "pc" ? t.characterId === k.entityId : t.definitionId === k.entityId;
        if (!own || !t.enabled) continue;
        const ent = db.select().from(entity).where(eq(entity.id, k.entityId)).get();
        db.insert(triggerState)
          .values({
            id: `ts-${++n}`,
            campaignId: enc.campaignId,
            encounterId: enc.id,
            combatantId: k.id,
            triggerId: t.id,
            characterId: t.characterId,
            ownerPlayerId: t.characterId ? (ent?.ownerPlayerId ?? null) : null,
            name: t.name,
            on: t.rule.on,
            armed: false,
            charge: "waiting",
            updatedAt: AT,
          })
          .run();
        ids[k.name] = k.id;
      }
    }
    h = await startTestServer({ db, fake: false });
    effectsChangedHooks.register({
      id: LINE,
      effectsChanged: (env, d) => standInLine(env as never, [...d.creatures]),
    });
  });

  afterAll(async () => {
    effectsChangedHooks.unregister(LINE);
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
    expect(summary(dm)).toEqual([
      "Divine Fury:off",
      "Martial Advantage:off",
      "Regeneration:off",
      "Sneak Attack:off",
    ]);
    expect(summary(p1)).toEqual(["Divine Fury:off"]);
    expect(summary(p2)).toEqual(["Sneak Attack:off"]);
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
    dm.intent(CBTX_INTENTS.addEffect, {
      targets: [{ characterId: brakka }],
      kind: "custom",
      label: "Rage-ish",
    });
    await dm.next("ack");
    // Martial Advantage's owner, the (hidden) Elite.
    const elite = ids["Elite Goblin Warrior"] as string;
    dm.intent(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: elite }],
      kind: "condition",
      condition: "prone",
    });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(summary(dm)).toEqual([
      "Divine Fury:armed",
      "Martial Advantage:armed",
      "Regeneration:off",
      "Sneak Attack:off",
    ]);
    expect(summary(p1)).toEqual(["Divine Fury:armed"]);
    expect(summary(p2)).toEqual(["Sneak Attack:off"]);
    // player-2's frames never carried a row of Brakka's or a monster's.
    const p2Rows = () =>
      p2.frames.flatMap((f) =>
        f.type === "event" ? f.changes.filter((c) => c.type === TRIGGER_STATE_TYPE) : [],
      );
    expect(p2Rows()).toEqual([]);
    await scan(p1);
    await scan(p2);

    // Owner reassignment (FR-MOD-54's owner copy): Brakka's rows → player-2.
    reassignTo = players["Player 2"]?.id as string;
    dm.intent(CBTX_INTENTS.addEffect, {
      targets: [{ characterId: brakka }],
      kind: "condition",
      condition: "prone",
    });
    await dm.next("ack");
    reassignTo = null;
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(summary(p1)).toEqual([]);
    expect(summary(p2)).toEqual(["Divine Fury:off", "Sneak Attack:off"]);
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
    const row = db
      .select()
      .from(triggerState)
      .where(inArray(triggerState.id, ["ts-1"]))
      .get();
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
