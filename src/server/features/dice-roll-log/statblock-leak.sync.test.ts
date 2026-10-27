// Kit parity K7 walkthrough F1 over real sockets on `kit-parity`: the stat block's plain rolls
// (FR-KIT-105, definition mode) are DM-only (K7 ruling 2026-10-27, ADR-0024 / FR-CHARX-22): the
// window's exact payloads (`dm/features/entities/statblock/logic.ts`, `public: false`) for the
// hidden Elite taken out of the fight and a compendium (imported) definition, with the attack /
// damage presets public: no player frame, nor a player snapshot after a reconnect, names either.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const ack = async (c: TestClient, id: string) => {
  for (;;) {
    const a = await c.next("ack", 3000);
    if ((a as { intentId?: string }).intentId === id) return a;
  }
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

describe("FR-KIT-105 ADR-0024 stat block plain rolls stay DM-only (kit-parity)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("kit-parity", { dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-KIT-105 ADR-0024 the hidden Elite out of the fight and a compendium definition: the window's attack / damage rolls as the definition reach no player (frames, reconnect snapshot) with the presets public", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // The attack / damage presets public (as the walkthrough's): only the window's `public: false`
    // keeps them hidden.
    for (const category of ["attack", "damage"]) {
      await ack(dm, dm.intent("dice.setCategoryPublic", { category, public: true }));
    }
    const elite = all<CombatantRecord>(dm, COMBATANT_TYPE).find(
      (c) => c.hidden && c.kind === "monster" && c.name.startsWith("Elite"),
    );
    expect(elite?.entityId).toBeTruthy();
    for (const c of [p1, p2]) {
      expect(all<CombatantRecord>(c, COMBATANT_TYPE).some((x) => x.id === elite?.id)).toBe(false);
    }
    const dragon = db
      .select({ id: entity.id, name: entity.name })
      .from(entity)
      .where(and(isNull(entity.campaignId), eq(entity.kind, "monster")))
      .all()
      .find((e) => !["Goblin", "Wolf", "Owlbear"].includes(e.name));
    expect(dragon).toBeTruthy();
    const marks = [p1.raw().length, p2.raw().length];

    // Out of the fight (Remove from combat: the window falls back to the definition, FR-KIT-104).
    await ack(dm, dm.intent("cbt.setRemoved", { combatantId: elite?.id, removed: true }));
    const name = elite?.name as string;
    const rolls = [
      {
        expression: "1d20+4",
        category: "attack",
        label: `${name} — Scimitar attack`,
        actor: { entityId: elite?.entityId },
      },
      {
        expression: "1d6+2",
        category: "damage",
        label: `${name} — Scimitar damage`,
        actor: { entityId: elite?.entityId },
      },
      {
        expression: "1d20+14",
        category: "attack",
        label: `${dragon?.name} — Bite attack`,
        actor: { entityId: dragon?.id },
      },
      {
        expression: "2d10+8",
        category: "damage",
        label: `${dragon?.name} — Bite damage`,
        actor: { entityId: dragon?.id },
      },
    ];
    // What the stat block sends (`plainRoll`): always `public: false`.
    for (const r of rolls) await ack(dm, dm.intent("dice.roll", { ...r, public: false }));
    const dmEntries = all<GameLogEntryRecord>(dm, GAME_LOG_ENTRY_TYPE)
      .sort((a, b) => a.n - b.n)
      .slice(-4);
    expect(dmEntries.map((e) => `${e.actorName}:${e.public}`)).toEqual([
      `${name}:false`,
      `${name}:false`,
      `${dragon?.name}:false`,
      `${dragon?.name}:false`,
    ]);

    const leaks = [name, dragon?.name as string, elite?.entityId as string, dragon?.id as string];
    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of leaks)
        expect({ leak, hit: since.includes(leak) }).toEqual({ leak, hit: false });
    }
    for (const c of [dm, p1, p2]) c.close();

    // Reconnect: no player snapshot names either creature.
    for (const who of ["Player 1", "Player 2"]) {
      const c = await h.live(p(who));
      const raw = c.raw();
      for (const leak of leaks)
        expect({ who, leak, hit: raw.includes(leak) }).toEqual({ who, leak, hit: false });
      c.close();
    }
  }, 60_000);
});
