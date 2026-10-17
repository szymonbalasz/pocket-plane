// CHARX sprint 3 (V5): the `char.edit` `senses` key on in-memory services. Permissions
// (FR-CHARX-49: owner unless locked, DM any character / custom NPC, imported read-only), the
// DM-only Sees invisible (FR-CHARX-53, #210), one `CharacterSheetEdited {fields: ["senses"]}`
// (FR-CHARX-52; FOG's re-derive line lands in V2) and the snapshot visibility (FR-CHARX-51).
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE, REDACTED_CHARACTER_KEYS } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { entity, eventLog } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { createEntity } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { SEES_INVISIBLE_DM_ONLY } from "./edit";

const I = CHARX_INTENTS;
const TORCH = { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false };
const DEVIL = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };

function setup() {
  const { s } = diceServices("senses");
  const t = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = (name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor });
  const elite = (
    run(createEntity.name, { kind: "monster", name: "Elite", statBlock: goblinBlock }) as {
      id: string;
    }
  ).id;
  events.length = 0;
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const senses = (id: string) => {
    const row = s.db.select().from(entity).where(eq(entity.id, id)).get();
    return (row?.statBlock as { senses?: object } | undefined)?.senses;
  };
  const logCount = () => s.db.select().from(eventLog).all().length;
  const edit = (id: string, value: object, actor: Actor = t.dm) =>
    run(I.edit, { creatureId: id, set: { senses: value } }, actor);
  return { s, t, events, run, fail, senses, logCount, edit, elite };
}

describe("FR-CHARX-49 char.edit senses", () => {
  test("FR-CHARX-49 owner sets Mira's senses: stored on the stat block, one event listing the key only; same value → no event", () => {
    const t = setup();
    t.edit(t.t.miraId, TORCH, t.t.p1Actor);
    expect(t.senses(t.t.miraId)).toEqual(TORCH);
    expect(t.events.map((e) => e.event.type)).toEqual(["CharacterSheetEdited"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({ creatureId: t.t.miraId, op: "set", fields: ["senses"] });
    expect(ev?.changes.map((c) => c.type)).toContain(ENTITY_TYPE);
    t.events.length = 0;
    t.edit(t.t.miraId, TORCH, t.t.p1Actor);
    expect(t.events).toEqual([]);
  });

  test("FR-CHARX-49 senses schema at the intent: vision 0–995 / darkvision 0–120 step 5, strict, whole object; nothing written", () => {
    const t = setup();
    const n = t.logCount();
    for (const bad of [
      { ...TORCH, darkvisionFt: 125 },
      { ...TORCH, visionFt: 999 },
      { ...TORCH, visionFt: 1000 },
      { ...TORCH, darkvisionFt: 7 },
      { ...TORCH, visionFt: -5 },
      { ...TORCH, extra: true },
      { visionFt: 30, darkvisionFt: 0 },
    ]) {
      expect(t.fail(() => t.edit(t.t.miraId, bad)).code).toBe("invalid");
    }
    expect(
      t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set: { senses: null } })).code,
    ).toBe("invalid");
    expect(t.logCount()).toBe(n);
    expect(t.senses(t.t.miraId)).toBeUndefined();
  });

  test("FR-CHARX-49 vision default: a char.edit without visionFt clears a stored value (Normal); 995 and a stored 0 are kept", () => {
    const t = setup();
    t.edit(t.t.miraId, { ...TORCH, visionFt: 995 });
    expect(t.senses(t.t.miraId)).toMatchObject({ visionFt: 995 });
    t.edit(t.t.miraId, { darkvisionFt: 0, seesMagicalDarkness: false });
    expect(t.senses(t.t.miraId)).toEqual({ darkvisionFt: 0, seesMagicalDarkness: false });
    t.edit(t.t.miraId, { ...TORCH, visionFt: 0 });
    expect(t.senses(t.t.miraId)).toMatchObject({ visionFt: 0 });
  });

  test("FR-CHARX-49 permissions: locked Mira, player-2 on Mira, imported Goblin → forbidden; DM on a custom NPC and a locked sheet ✓", () => {
    const t = setup();
    t.run(I.setLock, { characterId: t.t.miraId, locked: true });
    const n = t.logCount();
    expect(t.fail(() => t.edit(t.t.miraId, TORCH, t.t.p1Actor)).code).toBe("forbidden");
    t.run(I.setLock, { characterId: t.t.miraId, locked: false });
    expect(t.fail(() => t.edit(t.t.miraId, TORCH, t.t.p2Actor)).code).toBe("forbidden");
    expect(t.fail(() => t.edit(t.t.goblinId, DEVIL)).code).toBe("forbidden");
    // A player never reaches an NPC definition (FR-CHARX-18).
    expect(t.fail(() => t.edit(t.elite, DEVIL, t.t.p1Actor)).code).toBe("not_found");
    expect(t.logCount()).toBe(n + 1); // the unlock only
    t.edit(t.elite, DEVIL);
    expect(t.senses(t.elite)).toEqual(DEVIL);
    t.run(I.setLock, { characterId: t.t.miraId, locked: true });
    t.edit(t.t.miraId, TORCH);
    expect(t.senses(t.t.miraId)).toEqual(TORCH);
  });
});

describe("FR-CHARX-53 Sees invisible (DM only, #210)", () => {
  test("FR-CHARX-53 owner flipping seesInvisible → forbidden, nothing written; omitted or unchanged passes; DM sets and clears it", () => {
    const t = setup();
    const n = t.logCount();
    const err = t.fail(() => t.edit(t.t.thornId, { ...DEVIL, seesInvisible: true }, t.t.p2Actor));
    expect([err.code, err.message]).toEqual(["forbidden", SEES_INVISIBLE_DM_ONLY]);
    expect(t.logCount()).toBe(n);
    expect(t.senses(t.t.thornId)).toBeUndefined();
    // Unchanged (false) or omitted: the other senses stay owner-editable; false is not stored.
    t.edit(t.t.thornId, { ...DEVIL, seesInvisible: false }, t.t.p2Actor);
    expect(t.senses(t.t.thornId)).toEqual(DEVIL);
    t.edit(t.t.thornId, { ...DEVIL, darkvisionFt: 30 }, t.t.p2Actor);
    expect(t.senses(t.t.thornId)).toEqual({ ...DEVIL, darkvisionFt: 30 });
    // DM sets it: one event; the owner's later edit without the key keeps it.
    t.events.length = 0;
    t.edit(t.t.thornId, { ...DEVIL, seesInvisible: true });
    expect(t.events.map((e) => e.event.payload)).toEqual([
      { creatureId: t.t.thornId, op: "set", fields: ["senses"] },
    ]);
    t.edit(t.t.thornId, DEVIL, t.t.p2Actor);
    expect(t.senses(t.t.thornId)).toEqual({ ...DEVIL, seesInvisible: true });
    t.edit(t.t.thornId, { ...DEVIL, seesInvisible: true, darkvisionFt: 30 }, t.t.p2Actor);
    expect(t.senses(t.t.thornId)).toEqual({ ...DEVIL, darkvisionFt: 30, seesInvisible: true });
    expect(
      t.fail(() => t.edit(t.t.thornId, { ...DEVIL, seesInvisible: false }, t.t.p2Actor)).code,
    ).toBe("forbidden");
    t.edit(t.t.thornId, { ...DEVIL, seesInvisible: false });
    expect(t.senses(t.t.thornId)).toEqual(DEVIL);
  });
});

describe("FR-CHARX-51 senses visibility", () => {
  test("FR-CHARX-51 snapshot: DM and owner get senses; the other player's summary and every token carry none", () => {
    const t = setup();
    t.edit(t.t.miraId, TORCH);
    t.edit(t.t.thornId, { ...DEVIL, seesInvisible: true });
    const recs = (v: ReturnType<typeof t.t.viewer>, type: string) =>
      (t.t.snapshot(v)[type] ?? []) as { id: string; statBlock?: { senses?: object } }[];
    const by = (list: { id: string; statBlock?: { senses?: object } }[], id: string) =>
      list.find((r) => r.id === id);
    const dm = recs(t.t.viewer("dm"), ENTITY_TYPE);
    expect(by(dm, t.t.miraId)?.statBlock?.senses).toEqual(TORCH);
    expect(by(dm, t.t.thornId)?.statBlock?.senses).toEqual({ ...DEVIL, seesInvisible: true });
    const p1 = recs(t.t.viewer("player", t.t.p1.id), ENTITY_TYPE);
    expect(by(p1, t.t.miraId)?.statBlock?.senses).toEqual(TORCH);
    expect(Object.keys(by(p1, t.t.thornId) ?? {}).sort()).toEqual(
      [...REDACTED_CHARACTER_KEYS].sort(),
    );
    expect(JSON.stringify(t.t.snapshot(t.t.viewer("player", t.t.p1.id)))).not.toContain(
      "seesInvisible",
    );
    const p2 = recs(t.t.viewer("player", t.t.p2.id), ENTITY_TYPE);
    expect(Object.keys(by(p2, t.t.miraId) ?? {}).sort()).toEqual(
      [...REDACTED_CHARACTER_KEYS].sort(),
    );
    expect(JSON.stringify(t.t.snapshot(t.t.viewer("dm"))[TOKEN_TYPE])).not.toContain("senses");
  });
});
