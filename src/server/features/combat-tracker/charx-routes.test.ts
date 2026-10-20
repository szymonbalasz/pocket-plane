// character-sheet-full slice 4 on combat's side (FR-CHARX-24, OQ-CBT-46/47): `cbt.attack` with
// `attackId?` / `spellId?` resolved by CHARX's `sheetAttack`, the card it makes applied through
// CBTX's `hpRules`, and drafts left out of the whole party (FR-CHARX-11, FR-CBT-02).
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import {
  type AttackResult,
  type EncounterRecord,
  type HpChangeRecord,
  parseFullCard,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import { asc, eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { setTempHp } from "../combat-extras/play-state";
import { cbtxSetup } from "../combat-extras/testing";
import { attackCommand } from "./attack";
import { createEncounter } from "./encounters";
import { applyCard } from "./hp";
import { startCommand } from "./lifecycle";
import { combatSetup } from "./testing";

const I = CHARX_INTENTS;

/** CBTX's started ambush (round 1) + Mira's sheet rows: Light crossbow, three spells. */
function setup() {
  const t = cbtxSetup();
  const put = (creatureId: string, list: string, row: object, actor: Actor = t.h.dm) =>
    t.run<{ rowId: string }>(I.putRow, { creatureId, list, row }, actor).rowId;
  const crossbow = put(t.miraId, "attacks", {
    name: "Light crossbow",
    toHit: 4,
    damage: "1d8+2",
    damageType: "piercing",
  });
  // WIS 12 (+1) + proficiency 2 → spell attack +3.
  t.run(I.edit, {
    creatureId: t.miraId,
    set: { spellcasting: { ability: "wis", slots: { "1": 2 } } },
  });
  const bolt = put(t.miraId, "spells", {
    name: "Guiding Bolt",
    level: 1,
    roll: "attack",
    damage: "4d6",
    damageType: "radiant",
  });
  const touch = put(t.miraId, "spells", { name: "Shocking Touch", level: 0, roll: "attack" });
  const flame = put(t.miraId, "spells", {
    name: "Sacred Flame",
    level: 0,
    roll: "save",
    saveAbility: "dex",
    damage: "1d8",
    damageType: "radiant",
  });
  const p1 = t.player(t.h.p1);
  const attack = (attacker: string, extra: object = {}, actor: Actor = p1) =>
    t.run<AttackResult>(
      attackCommand.name,
      {
        attackerId: t.id(attacker),
        manual: [{ diceTotal: 14 }, { diceTotal: 6 }],
        ...extra,
      },
      actor,
    );
  const payload = (cardId: string) =>
    parseFullCard(
      t.s.db.select().from(notification).where(eq(notification.id, cardId)).get()?.payload,
    );
  const labels = (rollIds: string[]) =>
    rollIds.map((id) => {
      const r = t.s.db.select().from(roll).where(eq(roll.id, id)).get();
      return [r?.label, r?.expression];
    });
  const written = () => [t.count("roll"), t.count("game_log_entry"), t.count("notification")];
  return { ...t, p1, put, crossbow, bolt, touch, flame, attack, payload, labels, written };
}

describe("FR-CHARX-24 FR-CBT-16 cbt.attack with a sheet row", () => {
  test("FR-CHARX-24 attackId → that row's to-hit + damage; the card names it", () => {
    const t = setup();
    const r = t.attack("Mira", { attackId: t.crossbow });
    expect(t.labels(r.rollIds)).toEqual([
      ["Light crossbow attack", "1d20+4"],
      ["Light crossbow damage (piercing)", "1d8+2"],
    ]);
    expect(t.payload(r.cardId)).toMatchObject({
      attackerName: "Mira",
      attackName: "Light crossbow",
      damageType: "piercing",
      toHit: { total: 18 },
      damage: { total: 8 },
    });
  });

  test("FR-CHARX-20 FR-CBT-16 no ids = the first attack (MVP clients keep working)", () => {
    const t = setup();
    const r = t.attack("Mira");
    expect(t.labels(r.rollIds)).toEqual([
      ["Shortsword attack", "1d20+4"],
      ["Shortsword damage (piercing)", "1d6+2"],
    ]);
    expect(t.payload(r.cardId).attackName).toBe("Shortsword");
  });

  test("FR-CHARX-24 spellId (roll: attack, with damage) → spell attack bonus + damage, card + public line", () => {
    const t = setup();
    const n = t.events.length;
    const r = t.attack("Mira", { spellId: t.bolt });
    expect(t.typesSince(n)).toEqual(["AttackRolled", "NotificationCreated"]);
    expect(t.labels(r.rollIds)).toEqual([
      ["Guiding Bolt attack", "1d20+3"],
      ["Guiding Bolt damage (radiant)", "4d6"],
    ]);
    expect(t.payload(r.cardId)).toMatchObject({
      attackName: "Guiding Bolt",
      damageType: "radiant",
      toHit: { total: 17 },
    });
    const entry = t.s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all().at(-1);
    expect(entry).toMatchObject({ category: "attack", actorName: "Mira", public: true });
  });

  test("FR-CHARX-24 a spell attack without damage, a save spell, unknown rows, both ids → rejected, nothing written", () => {
    const t = setup();
    const before = t.written();
    const err = (extra: object) => t.err(() => t.attack("Mira", extra));
    expect([err({ spellId: t.touch }).code, err({ spellId: t.touch }).message]).toEqual([
      "conflict",
      "No damage roll for Shocking Touch",
    ]);
    expect(err({ spellId: t.flame }).message).toBe("No attack roll for Sacred Flame");
    expect(err({ spellId: "gone" }).code).toBe("not_found");
    expect(err({ attackId: "gone" }).code).toBe("not_found");
    expect(err({ attackId: t.crossbow, spellId: t.bolt }).code).toBe("invalid");
    expect(t.written()).toEqual(before);
  });

  test("FR-CHARX-24 FR-CBT-16 a player can't attack with another character's row", () => {
    const t = setup();
    const before = t.written();
    // Thorn's combatant with Thorn's own (legacy, first) attack → forbidden (not their PC).
    expect(t.err(() => t.attack("Thorn")).code).toBe("forbidden");
    const thornRow = t.put(t.thornId, "attacks", { name: "Sling", toHit: 5, damage: "1d4+3" });
    expect(t.err(() => t.attack("Thorn", { attackId: thornRow })).code).toBe("forbidden");
    // Own combatant, Thorn's row id → that row isn't Mira's: not_found.
    expect(t.err(() => t.attack("Mira", { attackId: thornRow })).code).toBe("not_found");
    expect(t.written()).toEqual(before);
  });

  test("FR-CHARX-24 OQ-CHARX-12 DM attacks with an NPC definition's second attack", () => {
    const t = setup();
    const bow = t.put(t.eliteId, "attacks", {
      name: "Shortbow",
      toHit: 5,
      damage: "1d6+3",
      damageType: "piercing",
    });
    const r = t.attack("Elite Goblin Warrior", { attackId: bow }, t.h.dm);
    expect(t.payload(r.cardId)).toMatchObject({ attackName: "Shortbow", damageType: "piercing" });
    expect(t.labels(r.rollIds)[0]).toEqual(["Shortbow attack", "1d20+5"]);
    // The SRD goblin (imported, no sheet) still attacks with its first attack.
    const g = t.attack("Goblin", {}, t.h.dm);
    expect(t.payload(g.cardId).attackName).toBe("Scimitar");
  });

  test("FR-CHARX-24 FR-CBTX-15 a spell attack's card applies through hpRules: temp HP absorbs first", () => {
    const t = setup();
    t.run(setTempHp.name, { target: { combatantId: t.id("Goblin") }, value: 3 });
    const r = t.attack("Mira", { spellId: t.bolt });
    const p = t.payload(r.cardId);
    t.run(applyCard.name, {
      cardId: r.cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      damageRollId: p.damage.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
    });
    const rows = t.s.db.select().from(hpChange).all() as HpChangeRecord[];
    expect(rows.at(-1)).toMatchObject({
      raw: 6,
      applied: 3,
      tempBefore: 3,
      tempAfter: 0,
      hpBefore: 7,
      hpAfter: 4,
    });
    expect(t.byName(t.enc.id).Goblin).toMatchObject({ tempHp: 0, hpCurrent: 4 });
  });
});

describe("FR-CHARX-11 FR-CBT-02 OQ-CBT-46 drafts and the whole party", () => {
  function withDraft() {
    const t = combatSetup();
    const brin = t.run<{ characterId: string }>(I.create, { name: "Brin" }, t.p1).characterId;
    const encounter = (partyCharacterIds: string[] | null) =>
      t.run<EncounterRecord>(createEncounter.name, {
        name: "Party test",
        partyCharacterIds,
        entries: [{ definitionId: t.h.goblinId, quantity: 1 }],
      });
    const start = (e: EncounterRecord) => {
      t.run(startCommand.name, { encounterId: e.id, sceneId: t.sceneId });
      return t
        .combatants(e.id)
        .filter((c) => c.kind === "pc")
        .map((c) => c.name);
    };
    return { ...t, brin, encounter, start };
  }

  test("FR-CHARX-11 OQ-CBT-46 partyCharacterIds null → every character but drafts", () => {
    const t = withDraft();
    expect(t.start(t.encounter(null))).toEqual(["Mira", "Thorn"]);
  });

  test("FR-CHARX-11 OQ-CBT-46 an explicit list may hold a draft", () => {
    const t = withDraft();
    expect(t.start(t.encounter([t.miraId, t.brin]))).toEqual(["Brin", "Mira"]);
  });

  test("FR-CHARX-10 an approved draft is in the whole party again", () => {
    const t = withDraft();
    t.run(I.approve, { characterId: t.brin });
    expect(t.start(t.encounter(null))).toEqual(["Brin", "Mira", "Thorn"]);
  });
});
