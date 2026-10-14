// character-sheet-full events (CHARX §9): registered, logged, not undoable; schemas round-trip.
import { describe, expect, test } from "bun:test";
import {
  CharacterApproved,
  CharacterCreated,
  CharacterLockSet,
  CharacterResourceUsed,
  CharacterRolled,
  CharacterSheetEdited,
} from "./character-sheet";
import { domainEvents } from "./index";

const CHARX_EVENTS = [
  "CharacterCreated",
  "CharacterApproved",
  "CharacterLockSet",
  "CharacterSheetEdited",
  "CharacterResourceUsed",
];

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("CHARX domain events (§9)", () => {
  test("FR-CHARX-19 every CHARX event registered once, logged, none undoable", () => {
    const defs = domainEvents.filter((e) => CHARX_EVENTS.includes(e.type));
    expect(defs.map((e) => e.type).sort()).toEqual([...CHARX_EVENTS].sort());
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-CHARX-08/10/12 created / approved / lock set payloads round-trip; strict", () => {
    roundTrip(CharacterCreated.payload, {
      characterId: "c1",
      ownerPlayerId: "p1",
      status: "draft",
    });
    roundTrip(CharacterApproved.payload, { characterId: "c1" });
    roundTrip(CharacterLockSet.payload, { characterId: "c1", locked: true });
    expect(
      CharacterCreated.payload.safeParse({ characterId: "c1", ownerPlayerId: "p1", status: "x" })
        .success,
    ).toBe(false);
    expect(CharacterApproved.payload.safeParse({ characterId: "c1", name: "Mira" }).success).toBe(
      false,
    );
  });

  test("FR-CHARX-15/16 CharacterSheetEdited: set lists fields; row ops list + rowId; never values", () => {
    const p = CharacterSheetEdited.payload;
    roundTrip(p, { creatureId: "c1", op: "set", fields: ["ac", "hpMax"] });
    roundTrip(p, { creatureId: "c1", op: "putRow", list: "spells", rowId: "r1" });
    roundTrip(p, { creatureId: "c1", op: "deleteRow", list: "attacks", rowId: "r1" });
    roundTrip(p, { creatureId: "c1", op: "moveRow", list: "items", rowId: "r1" });
    const bad = (v: object) => expect(p.safeParse({ creatureId: "c1", ...v }).success).toBe(false);
    bad({ op: "set" });
    bad({ op: "set", fields: [] });
    bad({ op: "set", fields: ["ac"], list: "spells", rowId: "r1" });
    bad({ op: "set", fields: ["hpCurrent"] });
    bad({ op: "putRow", list: "spells" });
    bad({ op: "putRow", list: "notes", rowId: "r1" });
    bad({ op: "putRow", fields: ["ac"], list: "spells", rowId: "r1" });
    bad({ op: "set", fields: ["ac"], values: { ac: 15 } });
  });

  test("FR-CHARX-17 CharacterResourceUsed: slot 1–9 | hit die | feature row; before / after ≥ 0", () => {
    const p = CharacterResourceUsed.payload;
    for (const resource of [{ slot: 1 }, { slot: 9 }, { hitDie: "d10" }, { feature: "f1" }]) {
      roundTrip(p, { characterId: "c1", resource, before: 0, after: 1 });
    }
    const bad = (resource: object, before = 0, after = 1) =>
      expect(p.safeParse({ characterId: "c1", resource, before, after }).success).toBe(false);
    bad({ slot: 0 });
    bad({ slot: 10 });
    bad({ hitDie: "d20" });
    bad({ slot: 1, hitDie: "d8" });
    bad({ slot: 1 }, -1);
  });

  test("FR-CHARX-20 CharacterRolled gains skill / damage / spell kinds and skill?, attackId?, spellId?", () => {
    const base = { characterId: "c1", mode: "normal", manual: false, rollIds: ["r"], entryId: "e" };
    roundTrip(CharacterRolled.payload, { ...base, kind: "skill", skill: "sleightOfHand" });
    roundTrip(CharacterRolled.payload, { ...base, kind: "damage", attackId: "a2" });
    roundTrip(CharacterRolled.payload, { ...base, kind: "spellAttack", spellId: "s1" });
    roundTrip(CharacterRolled.payload, { ...base, kind: "spellDamage", spellId: "s1" });
    // CHAR's shapes stay valid.
    roundTrip(CharacterRolled.payload, { ...base, kind: "attack", attackName: "Shortsword" });
    roundTrip(CharacterRolled.payload, { ...base, kind: "save", ability: "con" });
    expect(
      CharacterRolled.payload.safeParse({ ...base, kind: "skill", skill: "luck" }).success,
    ).toBe(false);
    // References only on their kinds.
    const bad = (p: object) =>
      expect(CharacterRolled.payload.safeParse({ ...base, ...p }).success).toBe(false);
    bad({ kind: "skill" });
    bad({ kind: "check", ability: "dex", skill: "stealth" });
    bad({ kind: "initiative", attackId: "a1" });
    bad({ kind: "spellAttack" });
    bad({ kind: "attack", spellId: "s1" });
    bad({ kind: "skill", skill: "stealth", ability: "dex" });
  });
});
