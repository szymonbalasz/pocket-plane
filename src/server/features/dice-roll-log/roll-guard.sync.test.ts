// FR-DICE-13 roll guard (sprint 14 F4, BL-135, DM #367 / #371) over real sockets on `kit-parity`, with
// the attack / damage / save presets public and the ambush scene shown: every roll path's DM roll
// as a hidden, renamed, or hidden and renamed monster reaches no player (live frames, then a
// reconnect snapshot); the unchanged public case reaches both.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { and, eq, isNotNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { combatant, player, scene, token } from "../../db/schema";
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
    if ((a as { intentId?: string }).intentId === id) return a as { result?: unknown };
  }
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

describe("FR-DICE-13 roll guard over sockets (kit-parity, #367)", () => {
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

  test("FR-DICE-13 hidden / renamed / both: dice.roll as token, combatant and definition, cbt.rollAbility and cbt.attack reach no player (frames, reconnect); the shown Goblin's rolls do", async () => {
    const dm = await h.live(DM);
    const send = async (name: string, input: unknown) =>
      (await ack(dm, dm.intent(name, input))).result as { entryId?: string };
    for (const category of ["attack", "damage", "saving-throw"]) {
      await send("dice.setCategoryPublic", { category, public: true });
    }
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    expect(ambush).toBeTruthy();
    await send("map.activateScene", { sceneId: ambush?.id });
    const tok = (name: string) => {
      const t = db
        .select()
        .from(token)
        .where(and(eq(token.sceneId, ambush?.id ?? ""), eq(token.name, name)))
        .get();
      if (!t) throw new Error(`no token ${name}`);
      return t;
    };
    const goblin = tok("Goblin");
    const goblin2 = tok("Goblin 2");
    const wolf = tok("Wolf");
    const elite = tok("Elite Goblin Warrior");
    expect([goblin.hidden, goblin2.hidden, wolf.hidden, elite.hidden]).toEqual([
      false,
      false,
      true,
      true,
    ]);
    const fighter = (tokenId: string) =>
      db
        .select()
        .from(combatant)
        .where(and(eq(combatant.tokenId, tokenId), isNotNull(combatant.encounterId)))
        .all()
        .find((c) => all<CombatantRecord>(dm, COMBATANT_TYPE).some((x) => x.id === c.id));
    const goblinC = fighter(goblin.id);
    const bobC = fighter(goblin2.id);
    const eliteC = fighter(elite.id);
    expect([goblinC, bobC, eliteC].every(Boolean)).toBe(true);

    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const marks = [p1.raw().length, p2.raw().length];
    const roll = async (marker: string, actor: unknown, extra: Record<string, unknown> = {}) =>
      (
        await send("dice.roll", {
          expression: "1d20+4",
          category: "attack",
          label: marker,
          actor,
          ...extra,
        })
      ).entryId as string;
    const save = async (combatantId: string | undefined) =>
      (
        await send("cbt.rollAbility", {
          combatantId,
          kind: "save",
          ability: "dex",
          public: true,
        })
      ).entryId as string;

    const shown = [
      await roll("GUARD-PUB-TOKEN", { tokenId: goblin.id }),
      await roll("GUARD-PUB-CBT", { combatantId: goblinC?.id }),
      await roll("GUARD-PUB-DEF", { entityId: goblin.definitionId }),
      await save(goblinC?.id),
    ];
    // Renamed (after the shown rolls: a definition roll checks every instance, pick 1): Goblin 2
    // → "Big Bob" (shown); both: the hidden Wolf → "Shadow".
    await send("map.updateToken", { tokenId: goblin2.id, name: "Big Bob" });
    await send("map.updateToken", { tokenId: wolf.id, name: "Shadow" });
    const secret: string[] = [];
    for (const extra of [{}, { public: true }]) {
      // Hidden.
      secret.push(await roll("GUARD-HID-TOKEN", { tokenId: elite.id }, extra));
      secret.push(await roll("GUARD-HID-CBT", { combatantId: eliteC?.id }, extra));
      secret.push(await roll("GUARD-HID-DEF", { entityId: elite.definitionId }, extra));
      // Renamed.
      secret.push(await roll("GUARD-REN-TOKEN", { tokenId: goblin2.id }, extra));
      secret.push(await roll("GUARD-REN-CBT", { combatantId: bobC?.id }, extra));
      // Hidden and renamed.
      secret.push(await roll("GUARD-BOTH-TOKEN", { tokenId: wolf.id }, extra));
      secret.push(await roll("GUARD-BOTH-DEF", { entityId: wolf.definitionId }, extra));
    }
    secret.push(await save(eliteC?.id), await save(bobC?.id));
    // A DM's attack line is DM-only anyway (FR-CBT-52); still nothing of it reaches a player.
    await send("cbt.attack", { attackerId: bobC?.id, rolls: "toHit" });

    const dmEntries = all<GameLogEntryRecord>(dm, GAME_LOG_ENTRY_TYPE);
    const stampOf = (id: string) => dmEntries.find((e) => e.id === id)?.public;
    expect(shown.map(stampOf)).toEqual(shown.map(() => true));
    expect(secret.map(stampOf)).toEqual(secret.map(() => false));

    const leaks = ["GUARD-HID", "GUARD-REN", "GUARD-BOTH", ...secret];
    const positives = ["GUARD-PUB-TOKEN", "GUARD-PUB-CBT", "GUARD-PUB-DEF", ...shown];
    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of leaks)
        expect({ i, leak, hit: since.includes(leak) }).toEqual({ i, leak, hit: false });
      for (const pos of positives)
        expect({ i, pos, hit: since.includes(pos) }).toEqual({ i, pos, hit: true });
    }
    for (const c of [dm, p1, p2]) c.close();

    // Reconnect: the snapshot carries the shown rolls, none of the guarded ones.
    for (const who of ["Player 1", "Player 2"]) {
      const c = await h.live(p(who));
      const raw = c.raw();
      for (const leak of leaks)
        expect({ who, leak, hit: raw.includes(leak) }).toEqual({ who, leak, hit: false });
      for (const pos of positives)
        expect({ who, pos, hit: raw.includes(pos) }).toEqual({ who, pos, hit: true });
      c.close();
    }
  }, 60_000);
});

describe("FR-DICE-13 roll guard over sockets: walkthrough F1 (kit-parity, #371)", () => {
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

  test("FR-DICE-13 #371 the Goblin fogged for Player 2 only (Fog all + a wall on y = 9, x 3–14): its Initiative save and definition attack / damage reach no player (frames, reconnect)", async () => {
    const dm = await h.live(DM);
    const send = async (name: string, input: unknown) =>
      (await ack(dm, dm.intent(name, input))).result as { entryId?: string };
    for (const category of ["attack", "damage", "saving-throw"]) {
      await send("dice.setCategoryPublic", { category, public: true });
    }
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    await send("map.activateScene", { sceneId: ambush?.id });
    await send("fog.setAll", { sceneId: ambush?.id, fogged: true });
    await send("scn.addWalls", { sceneId: ambush?.id, segments: [[3, 9, 14, 9]] });
    const goblin = db
      .select()
      .from(token)
      .where(and(eq(token.sceneId, ambush?.id ?? ""), eq(token.name, "Goblin")))
      .get();
    const ids = Object.fromEntries(
      db
        .select({ name: player.name, id: player.id })
        .from(player)
        .all()
        .map((r) => [r.name, r.id]),
    );
    // The walkthrough's state: Player 1 sees the Goblin, Player 2 doesn't.
    expect(goblin?.seenBy).toContain(ids["Player 1"]);
    expect(goblin?.seenBy).not.toContain(ids["Player 2"]);
    const goblinC = all<CombatantRecord>(dm, COMBATANT_TYPE).find(
      (c) => c.tokenId === goblin?.id && !c.removed,
    );
    expect(goblinC?.hidden).toBe(false);

    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const marks = [p1.raw().length, p2.raw().length];
    const secret = [
      (
        await send("cbt.rollAbility", {
          combatantId: goblinC?.id,
          kind: "save",
          ability: "dex",
          public: true,
        })
      ).entryId as string,
    ];
    for (const category of ["attack", "damage"]) {
      const r = await send("dice.roll", {
        expression: "1d20+4",
        category,
        label: `F1-FOGGED-DEF-${category}`,
        actor: { entityId: goblin?.definitionId },
      });
      secret.push(r.entryId as string);
    }
    const dmEntries = all<GameLogEntryRecord>(dm, GAME_LOG_ENTRY_TYPE);
    expect(secret.map((id) => dmEntries.find((e) => e.id === id)?.public)).toEqual([
      false,
      false,
      false,
    ]);
    const leaks = ["F1-FOGGED-DEF", ...secret];
    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of leaks)
        expect({ i, leak, hit: since.includes(leak) }).toEqual({ i, leak, hit: false });
    }
    for (const c of [dm, p1, p2]) c.close();
    for (const who of ["Player 1", "Player 2"]) {
      const c = await h.live(p(who));
      const raw = c.raw();
      for (const leak of leaks)
        expect({ who, leak, hit: raw.includes(leak) }).toEqual({ who, leak, hit: false });
      c.close();
    }
  }, 60_000);
});
