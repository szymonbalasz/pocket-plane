// CMP §13 integration (C4) over real sockets on the `compendium` bundle: FR-CMP-28 `cmp.addToSheet`
// (sheet row + FR-CMP-29 trigger in one transaction; authorisation as `char.putRow`; entry
// visibility; MOD validation failure and a crash before commit write neither) and the per-player
// leak scan over snapshots, event frames and load replies, before and after reconnect, while
// the DM derives "Goblin Sneak" with its traits copied (FR-CMP-27).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { DIVINE_FURY_RULE } from "@fixtures/units/compendium/cmp-homebrew";
import { CHARX_INTENTS, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { CMP_INTENTS } from "@shared/compendium/homebrew";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { compendiumEntry, creatureSheet, entity, player, ruleTrigger } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { DERIVE_MONSTER } from "./derive";
import { PUT_ENTRY } from "./homebrew";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const PLAYER_LEAKS = [
  "CMP-SECRET-ITEM",
  "CMP-SECOND-HOMEBREW",
  "Nimble Escape",
  "Fireball (house)",
];

let h: TestServer;
let db: Db;
let dir: string;
let cid: string;
let players: Record<string, { id: string; token: string }>;

beforeAll(async () => {
  const loaded = await loadBundle("compendium", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  const rows = db.select().from(player).all();
  players = Object.fromEntries(rows.map((r) => [r.name, { id: r.id, token: r.linkToken }]));
  cid = rows.find((r) => r.name === "Player 1")?.campaignId as string;
  h = await startTestServer({ db, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const p = (name: string) => ({ role: "player" as const, token: players[name]?.token as string });
const dmActor = (): Actor => ({ role: "dm", playerId: null, campaignId: cid });
const playerActor = (name: string): Actor => ({
  role: "player",
  playerId: players[name]?.id as string,
  campaignId: cid,
});
const entryId = (name: string) =>
  db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get()?.id as string;
const charId = (name: string) =>
  db
    .select()
    .from(entity)
    .where(and(eq(entity.name, name), eq(entity.campaignId, cid)))
    .get()?.id as string;
const sheet = (id: string) =>
  db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get() as
    | (CreatureSheetRecord & { entityId: string })
    | undefined;
const triggers = (characterId: string) =>
  db.select().from(ruleTrigger).where(eq(ruleTrigger.characterId, characterId)).all();
const counts = (id: string) => {
  const s = sheet(id);
  return {
    spells: s?.spells.length ?? 0,
    features: s?.features.length ?? 0,
    items: s?.items.length ?? 0,
    triggers: triggers(id).length,
  };
};

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

function errorOf(fn: () => unknown): CommandError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
}

const run = (input: unknown, actor: Actor = dmActor()) =>
  h.s.commands.run(CMP_INTENTS.addToSheet, input, { actor });

describe("cmp.addToSheet (C4)", () => {
  test("FR-CMP-28 FR-CMP-29 Sneak Attack → Thorn row (source SRD 5.1) + the sneak-attack trigger in one tx; Player 2's own intent; live to the owner", async () => {
    const thorn = charId("Thorn");
    const p2 = await h.live(p("Player 2"));
    p2.load(RULE_TRIGGER_TYPE);
    const id = p2.intent(CMP_INTENTS.addToSheet, {
      entryId: entryId("Sneak Attack"),
      characterId: thorn,
    });
    const ack = await answer(p2, id);
    expect(ack.type).toBe("ack");
    const result = (ack as { result: { list: string; rowId: string; triggerId?: string } }).result;
    expect(result.list).toBe("features");
    const row = sheet(thorn)?.features.find((f) => f.id === result.rowId);
    expect(row).toMatchObject({ name: "Sneak Attack", source: "SRD 5.1" });
    expect(row?.text.length).toBeLessThanOrEqual(600);
    const t = triggers(thorn).find((x) => x.id === result.triggerId);
    expect(t).toMatchObject({ name: "Sneak Attack", ownerPlayerId: players["Player 2"]?.id });
    const log = readEventLog(db, cid).slice(-2);
    expect(log.map((x) => x.type)).toEqual(["CharacterSheetEdited", "RuleTriggerSaved"]);
    expect(log[1]?.payload).toEqual({ triggerId: result.triggerId });
    // The owner's client got the sheet row and the trigger upsert.
    const deadline = Date.now() + 1000;
    while (!p2.store.records[RULE_TRIGGER_TYPE]?.[result.triggerId as string]) {
      if (Date.now() > deadline) throw new Error("trigger never reached the owner");
      await p2.next(undefined, 1000);
    }
    p2.close();
  });

  test("FR-CMP-28 FR-CMP-29 DM adds homebrew 'Divine Fury' → Mira row + a 'Divine Fury' trigger with the inline rule (#209); spell and item rows", () => {
    const mira = charId("Mira");
    const r = run({ entryId: entryId("Divine Fury"), characterId: mira }) as {
      rowId: string;
      triggerId: string;
    };
    expect(sheet(mira)?.features.find((f) => f.id === r.rowId)).toMatchObject({
      name: "Divine Fury",
      source: "Homebrew",
    });
    const t = triggers(mira).find((x) => x.id === r.triggerId);
    expect(t?.name).toBe("Divine Fury");
    expect(t?.rule).toEqual(DIVINE_FURY_RULE);

    const spell = run({ entryId: entryId("Fireball"), characterId: mira }) as {
      list: string;
      rowId: string;
      triggerId?: string;
    };
    expect(spell.list).toBe("spells");
    expect(spell.triggerId).toBeUndefined();
    expect(sheet(mira)?.spells.find((s) => s.id === spell.rowId)).toMatchObject({
      name: "Fireball",
      level: 3,
      concentration: false,
      ritual: false,
      roll: "none",
      effect: "damage",
    });
    const item = run(
      { entryId: entryId("Moonblade Shard"), characterId: mira },
      playerActor("Player 1"),
    ) as { list: string; rowId: string };
    expect(sheet(mira)?.items.find((i) => i.id === item.rowId)).toMatchObject({
      name: "Moonblade Shard",
      qty: 1,
    });
  });

  test("FR-CMP-28 refusals write nothing: another's character / locked sheet → forbidden; unshared homebrew, a monster entry or an NPC → not_found; a condition → invalid", () => {
    const mira = charId("Mira");
    const thorn = charId("Thorn");
    const before = [counts(mira), counts(thorn)];
    const sneak = entryId("Sneak Attack");
    const p1 = playerActor("Player 1");
    expect(errorOf(() => run({ entryId: sneak, characterId: thorn }, p1)).code).toBe("forbidden");
    h.s.commands.run(
      CHARX_INTENTS.setLock,
      { characterId: mira, locked: true },
      { actor: dmActor() },
    );
    const locked = errorOf(() => run({ entryId: sneak, characterId: mira }, p1));
    expect([locked.code, locked.message]).toEqual(["forbidden", "Locked by the DM"]);
    h.s.commands.run(
      CHARX_INTENTS.setLock,
      { characterId: mira, locked: false },
      { actor: dmActor() },
    );
    for (const name of ["CMP-SECRET-ITEM", "Fireball (house)", "Goblin", "CMP-SECOND-HOMEBREW"]) {
      const e = errorOf(() => run({ entryId: entryId(name), characterId: mira }, p1));
      expect([name, e.code, e.message]).toEqual([name, "not_found", "Entry not found"]);
    }
    expect(errorOf(() => run({ entryId: "nope", characterId: mira }, p1)).code).toBe("not_found");
    expect(errorOf(() => run({ entryId: entryId("Poisoned"), characterId: mira })).code).toBe(
      "invalid",
    );
    // An NPC (custom monster) has a sheet but no Add to sheet.
    const npc = charId("Elite Goblin Warrior");
    expect(npc).toBeTruthy();
    expect(errorOf(() => run({ entryId: sneak, characterId: npc })).code).toBe("not_found");
    expect([counts(mira), counts(thorn)]).toEqual(before);
  });

  test("FR-CMP-28 MOD validation failure → neither row nor trigger; crash cmp.addToSheet:before-commit → neither", () => {
    const mira = charId("Mira");
    const { entryId: broken } = h.s.commands.run(
      PUT_ENTRY,
      {
        entry: {
          kind: "feature",
          name: "Broken Fury",
          facets: { className: "Barbarian" },
          body: { text: "t" },
        },
      },
      { actor: dmActor() },
    ) as { entryId: string };
    // A stored rule MOD no longer accepts (written before a MOD change).
    db.update(compendiumEntry)
      .set({ body: { text: "t", preset: { on: "hit" } } })
      .where(eq(compendiumEntry.id, broken))
      .run();
    const before = counts(mira);
    expect(errorOf(() => run({ entryId: broken, characterId: mira })).code).toBe("invalid");
    expect(counts(mira)).toEqual(before);

    class Killed extends Error {}
    try {
      armCrashHook({ point: "before-commit", target: CMP_INTENTS.addToSheet }, () => {
        throw new Killed("killed");
      });
      expect(() => run({ entryId: entryId("Divine Fury"), characterId: mira })).toThrow();
    } finally {
      armCrashHook(null);
    }
    expect(counts(mira)).toEqual(before);
  });

  test("CMP §13 leak scan: players never receive CMP-SECRET-ITEM, Fireball (house), Nimble Escape, CMP-SECOND-HOMEBREW (snapshots, frames, load acks; before and after reconnect) while the DM derives Goblin Sneak", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    for (const c of [p1, p2]) c.load(RULE_TRIGGER_TYPE);
    const goblin = db
      .select()
      .from(compendiumEntry)
      .where(eq(compendiumEntry.sourceKey, "monster/goblin"))
      .get();
    const def = db
      .select()
      .from(entity)
      .where(eq(entity.id, goblin?.definitionId as string))
      .get();
    h.s.commands.run(
      DERIVE_MONSTER,
      {
        entryId: goblin?.id,
        entity: { kind: "monster", name: "Goblin Sneak", statBlock: def?.statBlock },
        copyText: true,
      },
      { actor: dmActor() },
    );
    run({ entryId: entryId("Moonblade Shard"), characterId: charId("Mira") });
    // The DM sees the derived NPC's sheet; a ping round trip flushes every frame.
    for (const c of [dm, p1, p2]) {
      c.send({ type: "ping" });
      await c.next("pong");
    }
    expect(dm.raw()).toContain("Nimble Escape");
    const scanned = [p1.raw(), p2.raw()];
    for (const c of [p1, p2]) c.close();
    for (const name of ["Player 1", "Player 2"]) {
      const c = await h.live(p(name));
      c.load(RULE_TRIGGER_TYPE);
      c.send({ type: "ping" });
      await c.next("pong");
      scanned.push(c.raw());
      c.close();
    }
    for (const raw of scanned) {
      for (const leak of PLAYER_LEAKS) expect(raw).not.toContain(leak);
    }
    dm.close();
  });
});
