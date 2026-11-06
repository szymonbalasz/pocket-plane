// Flexible Casting over the command bus (class-resources FR-CRES-05–08): `char.convertSlot`,
// `char.createSlot`, ticking a level with created slots, the long rest, roles (owner on a locked
// sheet ok, another player refused), one event each, and what other players receive (nothing).
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { creatureSheet } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

function setup() {
  const { s } = diceServices("cres-sorcery");
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
  const sheet = () => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, t.miraId)).get();
    if (!row) throw new Error("no sheet");
    return toSheetRecord(row);
  };
  run(I.edit, {
    creatureId: t.miraId,
    set: {
      spellcasting: { ability: "cha", slots: { "1": 4, "2": 3 }, pact: { level: 1, slots: 2 } },
    },
  });
  const font = run<{ rowId: string }>(I.putRow, {
    creatureId: t.miraId,
    list: "features",
    row: { name: "Font of Magic", usesMax: 5, reset: "long", pool: "sorcery-points" },
  }).rowId;
  const points = () => 5 - (sheet().features.find((f) => f.id === font)?.used ?? 0);
  const spend = (n: number) =>
    run(I.useResource, { characterId: t.miraId, resource: { feature: font }, delta: n });
  const convert = (from: object, actor: Actor = t.dm) =>
    run<{ points: number }>(I.convertSlot, { characterId: t.miraId, from }, actor);
  const create = (level: number, actor: Actor = t.dm) =>
    run<{ points: number }>(I.createSlot, { characterId: t.miraId, level }, actor);
  return { s, t, run, fail, sheet, font, points, spend, convert, create, events };
}

describe("FR-CRES-05 sorcery points row", () => {
  test("FR-CRES-05 a second sorcery points row is refused", () => {
    const x = setup();
    const e = x.fail(() =>
      x.run(I.putRow, {
        creatureId: x.t.miraId,
        list: "features",
        row: { name: "Spare Font", usesMax: 3, pool: "sorcery-points" },
      }),
    );
    expect(e.code).toBe("invalid");
  });
});

describe("FR-CRES-06 char.convertSlot", () => {
  test("FR-CRES-06 owner converts a 2nd-level slot and a pact slot; one event each, sheet change only", () => {
    const x = setup();
    x.spend(4);
    x.events.length = 0;
    expect(x.convert({ slot: 2 }, x.t.p1Actor)).toEqual({ points: 3 });
    expect(x.sheet().slotsUsed).toEqual({ "2": 1 });
    expect(x.convert({ pact: true }, x.t.p1Actor)).toEqual({ points: 4 });
    expect(x.sheet().pactUsed).toBe(1);
    const types = x.events.map((e) => e.event.type);
    expect(types).toEqual(["CharacterSlotConverted", "CharacterSlotConverted"]);
    expect(x.events[0]?.event.changes.map((c) => c.type)).toEqual([CREATURE_SHEET_TYPE]);
  });

  test("FR-CRES-06 full points, no slot, another player → refused, nothing written", () => {
    const x = setup();
    expect(x.fail(() => x.convert({ slot: 1 })).message).toBe("Sorcery points are full");
    x.spend(5);
    x.run(I.useResource, { characterId: x.t.miraId, resource: { slot: 2 }, delta: 3 });
    expect(x.fail(() => x.convert({ slot: 2 })).message).toBe("No 2nd-level slot left");
    expect(x.fail(() => x.convert({ slot: 1 }, x.t.p2Actor)).code).toBe("forbidden");
    expect(x.points()).toBe(0);
  });

  test("FR-CRES-06 the owner converts on a locked sheet", () => {
    const x = setup();
    x.spend(1);
    x.run(I.setLock, { characterId: x.t.miraId, locked: true });
    expect(x.convert({ slot: 1 }, x.t.p1Actor)).toEqual({ points: 5 });
  });
});

describe("FR-CRES-07 char.createSlot", () => {
  test("FR-CRES-07 a 2nd-level slot costs 3; not enough points refused", () => {
    const x = setup();
    expect(x.create(2, x.t.p1Actor)).toEqual({ points: 2 });
    expect(x.sheet().slotsCreated).toEqual({ "2": 1 });
    expect(x.fail(() => x.create(3)).message).toBe(
      "A 3rd-level slot costs 5 sorcery points (2 left)",
    );
    expect(x.fail(() => x.create(6)).code).toBe("invalid");
  });
});

describe("FR-CRES-08 created slots", () => {
  test("FR-CRES-08 ticking the level spends the created slot first; long rest clears created", () => {
    const x = setup();
    x.create(1);
    x.create(1);
    expect(x.sheet().slotsCreated).toEqual({ "1": 2 });
    x.run(I.useResource, { characterId: x.t.miraId, resource: { slot: 1 }, delta: 1 });
    expect([x.sheet().slotsCreated, x.sheet().slotsUsed]).toEqual([{ "1": 1 }, {}]);
    x.run(I.rest, { characterIds: [x.t.miraId], kind: "short" });
    expect(x.sheet().slotsCreated).toEqual({ "1": 1 });
    x.run(I.rest, { characterIds: [x.t.miraId], kind: "long" });
    expect(x.sheet().slotsCreated).toEqual({});
    expect(x.points()).toBe(5);
  });
});
