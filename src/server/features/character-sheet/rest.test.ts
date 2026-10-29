// `char.rest` (FR-CHARX-121–124): short vs long resets, hit dice regain, negative feature uses,
// temp HP and death saves, nothing to change → no event, monsters and players refused, one
// transaction for the party, and per-viewer visibility (players get only what they already would).
import { describe, expect, test } from "bun:test";
import { LOG_KIND_CHAR_REST } from "@shared/character-sheet/rest-kind";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { creatureSheet, entity, gameLogEntry } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { createEntity } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

function setup() {
  const { s } = diceServices("char-rest");
  const t = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = <R = Record<string, unknown>>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const sheet = (id: string) => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get();
    return row ? toSheetRecord(row) : null;
  };
  const char = (id: string) => {
    const r = s.db.select().from(entity).where(eq(entity.id, id)).get();
    if (!r) throw new Error("no entity");
    return r;
  };
  const feature = (id: string, name: string, usesMax: number, reset?: "short" | "long") =>
    run<{ rowId: string }>(I.putRow, {
      creatureId: id,
      list: "features",
      row: { name, usesMax, ...(reset ? { reset } : {}) },
    }).rowId;
  const use = (id: string, resource: object, delta: number) =>
    run(I.useResource, { characterId: id, resource, delta });
  const used = (id: string, rowId: string) => sheet(id)?.features.find((f) => f.id === rowId)?.used;
  const rest = (characterIds: string[], kind: "short" | "long", actor: Actor = t.dm) =>
    run<{ rested: string[] }>(I.rest, { characterIds, kind }, actor);
  // Mira: Fighter 3 (d10) + Wizard 2 (d6), slots 1st ×3 / 2nd ×1; features per reset.
  run(I.edit, {
    creatureId: t.miraId,
    set: {
      classes: [
        { name: "Fighter", level: 3, hitDie: "d10" },
        { name: "Wizard", level: 2, hitDie: "d6" },
      ],
      spellcasting: { ability: "int", slots: { "1": 3, "2": 1 } },
    },
  });
  const surge = feature(t.miraId, "Action Surge", 1, "short");
  const lucky = feature(t.miraId, "Lucky", 3, "long");
  const tally = feature(t.miraId, "Tally", 2);
  events.length = 0;
  return { s, t, events, run, fail, sheet, char, use, used, rest, surge, lucky, tally };
}

/** Spends everything on Mira: HP −10, temp 5, death 1 / 1, slots, hit dice, all three rows. */
function spendMira(x: ReturnType<typeof setup>) {
  const { t, run, use } = x;
  run(I.useResource, { characterId: t.miraId, resource: { slot: 1 }, delta: 3 });
  use(t.miraId, { slot: 2 }, 1);
  use(t.miraId, { hitDie: "d10" }, 3);
  use(t.miraId, { hitDie: "d6" }, 2);
  use(t.miraId, { feature: x.surge }, 3); // −2 left (FR-CHARX-58)
  use(t.miraId, { feature: x.lucky }, 2);
  use(t.miraId, { feature: x.tally }, 1);
  run("char.adjustHp", { characterId: t.miraId, delta: -10 });
  x.s.db
    .update(entity)
    .set({ tempHp: 5, deathSuccesses: 1, deathFailures: 1 })
    .where(eq(entity.id, t.miraId))
    .run();
  x.events.length = 0;
}

describe("char.rest", () => {
  test("FR-CHARX-121 short rest resets only short-rest feature uses (also below zero)", () => {
    const x = setup();
    spendMira(x);
    const hpBefore = x.char(x.t.miraId).hpCurrent;
    expect(x.rest([x.t.miraId], "short")).toEqual({ rested: [x.t.miraId] });
    expect(x.used(x.t.miraId, x.surge)).toBe(0);
    expect(x.used(x.t.miraId, x.lucky)).toBe(2);
    expect(x.used(x.t.miraId, x.tally)).toBe(1);
    const sh = x.sheet(x.t.miraId);
    expect(sh?.slotsUsed).toEqual({ "1": 3, "2": 1 });
    expect(sh?.hitDiceUsed).toEqual({ d10: 3, d6: 2 });
    const c = x.char(x.t.miraId);
    expect(c.hpCurrent).toBe(hpBefore);
    expect([c.tempHp, c.deathSuccesses, c.deathFailures]).toEqual([5, 1, 1]);
    // One event: the sheet + the line, no entity change.
    expect(x.events.map((e) => e.event.type)).toEqual(["CharacterRested"]);
    const ev = x.events[0]?.event;
    expect(ev?.payload).toMatchObject({ characterId: x.t.miraId, kind: "short" });
    expect(ev?.changes.map((ch) => ch.type).sort()).toEqual(
      [CREATURE_SHEET_TYPE, GAME_LOG_ENTRY_TYPE].sort(),
    );
  });

  test("FR-CHARX-122 long rest: HP max, temp 0, death saves cleared, slots, short + long features, hit dice", () => {
    const x = setup();
    spendMira(x);
    x.rest([x.t.miraId], "long");
    const c = x.char(x.t.miraId);
    const hpMax = (c.statBlock as { hpMax: number }).hpMax;
    expect(c.hpCurrent).toBe(hpMax);
    expect([c.tempHp, c.deathSuccesses, c.deathFailures]).toEqual([0, 0, 0]);
    const sh = x.sheet(x.t.miraId);
    expect(sh?.slotsUsed).toEqual({});
    expect(x.used(x.t.miraId, x.surge)).toBe(0);
    expect(x.used(x.t.miraId, x.lucky)).toBe(0);
    // A row without `reset` keeps its count.
    expect(x.used(x.t.miraId, x.tally)).toBe(1);
    // Level 5 → ⌊5 / 2⌋ = 2 back, largest first: d10 3 → 1, d6 untouched.
    expect(sh?.hitDiceUsed).toEqual({ d10: 1, d6: 2 });
    const ev = x.events[0]?.event;
    expect(ev?.changes.map((ch) => ch.type).sort()).toEqual(
      [CREATURE_SHEET_TYPE, ENTITY_TYPE, GAME_LOG_ENTRY_TYPE].sort(),
    );
    // Again: 2 more dice back (d10 1 → 0, then d6 2 → 1).
    x.rest([x.t.miraId], "long");
    expect(x.sheet(x.t.miraId)?.hitDiceUsed).toEqual({ d6: 1 });
  });

  test("FR-CHARX-122 hit dice regain: min 1 at level 1, rounding down, multiclass largest first", () => {
    const x = setup();
    // Thorn: Barbarian 1 (d12), 1 die spent → level 1 still regains 1.
    x.run(I.edit, {
      creatureId: x.t.thornId,
      set: { classes: [{ name: "Barbarian", level: 1, hitDie: "d12" }] },
    });
    x.use(x.t.thornId, { hitDie: "d12" }, 1);
    x.rest([x.t.thornId], "long");
    expect(x.sheet(x.t.thornId)?.hitDiceUsed).toEqual({});
    // Mira (level 5, ⌊2.5⌋ = 2): only d6 spent → both from the d6.
    x.use(x.t.miraId, { hitDie: "d6" }, 2);
    x.rest([x.t.miraId], "long");
    expect(x.sheet(x.t.miraId)?.hitDiceUsed).toEqual({});
  });

  test("FR-CHARX-121 nothing to change → no write, no line, no event", () => {
    const x = setup();
    expect(x.rest([x.t.miraId], "short")).toEqual({ rested: [] });
    // Thorn is at full HP, no sheet row: a long rest changes nothing, writes no sheet row.
    expect(x.rest([x.t.thornId], "long")).toEqual({ rested: [] });
    expect(x.sheet(x.t.thornId)).toBeNull();
    expect(x.events).toEqual([]);
    const lines = x.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.kind, LOG_KIND_CHAR_REST))
      .all();
    expect(lines).toEqual([]);
  });

  test("FR-CHARX-121 party rest: one transaction, one event per changed character, sent order", () => {
    const x = setup();
    spendMira(x);
    x.run("char.adjustHp", { characterId: x.t.thornId, delta: -3 });
    x.events.length = 0;
    expect(x.rest([x.t.thornId, x.t.miraId], "long")).toEqual({
      rested: [x.t.thornId, x.t.miraId],
    });
    expect(x.events.map((e) => (e.event.payload as { characterId: string }).characterId)).toEqual([
      x.t.thornId,
      x.t.miraId,
    ]);
    // A bad id anywhere → nothing written (validated first, one transaction).
    x.use(x.t.miraId, { slot: 1 }, 1);
    x.events.length = 0;
    const err = x.fail(() => x.rest([x.t.miraId, x.t.strangerId], "long"));
    expect(err.code).toBe("not_found");
    expect(x.sheet(x.t.miraId)?.slotsUsed).toEqual({ "1": 1 });
    expect(x.events).toEqual([]);
    // Duplicates → invalid.
    expect(x.fail(() => x.rest([x.t.miraId, x.t.miraId], "long")).code).toBe("invalid");
  });

  test("FR-CHARX-121 monsters and NPC definitions refused; players refused", () => {
    const x = setup();
    const ogre = x.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Ogre",
      statBlock: goblinBlock,
    }).id;
    expect(x.fail(() => x.rest([ogre], "long")).code).toBe("invalid");
    expect(x.fail(() => x.rest([x.t.goblinId], "long")).code).toBe("forbidden");
    // The owner may not rest their own character (DM only).
    x.use(x.t.miraId, { slot: 1 }, 1);
    expect(x.fail(() => x.rest([x.t.miraId], "long", x.t.p1Actor)).code).toBe("forbidden");
    expect(x.sheet(x.t.miraId)?.slotsUsed).toEqual({ "1": 1 });
  });

  test("FR-CHARX-124 visibility: the line and sheet reach the DM and the owner; others the redacted entity only", () => {
    const x = setup();
    spendMira(x);
    x.rest([x.t.miraId], "long");
    const changes = x.events[0]?.event.changes ?? [];
    const of = (type: string) => {
      const c = changes.find((ch) => ch.type === type);
      if (!c) throw new Error(`no ${type}`);
      return c;
    };
    const dm = x.t.viewer("dm");
    const p1 = x.t.viewer("player", x.t.p1.id);
    const p2 = x.t.viewer("player", x.t.p2.id);
    const f = (type: string, v: ReturnType<typeof x.t.viewer>) =>
      x.s.records.filterChange(of(type), v);
    // Line: DM + owner, "Mira takes a long rest".
    expect(f(GAME_LOG_ENTRY_TYPE, dm)).not.toBeNull();
    expect(f(GAME_LOG_ENTRY_TYPE, p1)).not.toBeNull();
    expect(f(GAME_LOG_ENTRY_TYPE, p2)).toBeNull();
    // Sheet counters: DM + owner only.
    expect(f(CREATURE_SHEET_TYPE, p1)).not.toBeNull();
    expect(f(CREATURE_SHEET_TYPE, p2)).toBeNull();
    // Entity: the owner full; another player the whitelist (HP, temp HP; never death counters).
    const other = f(ENTITY_TYPE, p2);
    expect(other?.op).toBe("upsert");
    const data = other?.op === "upsert" ? (other.data as Record<string, unknown>) : {};
    expect(data.hpCurrent).toBe(x.char(x.t.miraId).hpCurrent);
    expect("deathFailures" in data).toBe(false);
    expect("statBlock" in data).toBe(false);
  });
});
