// Sprint 6 track CP, CP0 core (CBT §13.3): owner fields and `cbt.setCompanion` (FR-CBT-105,
// -111), turn modes and ranks (FR-CBT-106–108), pets at Start (FR-CBT-109), Undo after Dismiss
// (FR-CBT-112), End write-back (FR-CBT-113), the owner's attacks and roll lines (FR-CBT-114),
// visibility (FR-CBT-116), the card refresh (FR-CBT-117) and the `cbt.companion` lines (FR-CBT-122).
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { companionLogKind } from "@shared/combat-tracker/companion-kind";
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import { ranks, stepTurn, unrolledMonsters } from "@shared/combat-tracker/rules";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { MOD_TRIGGER_KIND } from "@shared/effect-modifiers/reminders";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { CompanionChanged } from "@shared/events/combat-tracker";
import { MAP_INTENTS, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { combatant, entity, notification } from "../../db/schema";
import { attackCommand } from "./attack";
import { AFTER_ITS_TURN, PET_OWNER_HERE } from "./companions";
import { cpSetup } from "./cp-testing";
import { applyHp, UNDO_DISMISSED, undoCommand } from "./hp";
import { rollInitiative, setInitiative, setRemoved } from "./initiative";

const row = (id: string, o: Partial<Parameters<typeof ranks>[0][number]> = {}) => ({
  id,
  seq: Number(id.replace(/\D/g, "")) || 1,
  kind: "monster" as const,
  initiative: null,
  initBonus: 0,
  active: true,
  removed: false,
  hidden: false,
  ...o,
});

const orderOf = (m: ReturnType<typeof ranks>) =>
  [...m.entries()]
    .filter(([, v]) => v.position !== null)
    .sort((a, b) => (a[1].position ?? 0) - (b[1].position ?? 0))
    .map(([id]) => id);

describe("FR-CBT-105 / -111 owner and setCompanion", () => {
  test("FR-CBT-105 owner set and cleared", () => {
    const t = cpSetup();
    const g2 = t.combatantNamed("Goblin 2");
    const n = t.events.length;
    t.setCompanion({ combatantId: g2.id, owner: t.owner(t.miraId, "after-owner") });
    const after = t.combatantRow(g2.id);
    expect(after).toMatchObject({
      ownerCharacterId: t.miraId,
      ownerPlayerId: t.h.p1.id,
      turnMode: "after-owner",
      pet: false,
      side: "ally",
      publicSide: "ally",
    });
    expect(after.card?.attacks.map((a) => a.name)).toEqual(["Scimitar"]);
    // FR-MAP-74: the bound token follows the owner.
    expect(t.tokenRow(t.tokens.goblin2).ownerPlayerId).toBe(t.h.p1.id);
    const ev = t.events.slice(n);
    expect(ev.map((e) => e.event.type)).toEqual([CompanionChanged.type]);
    const lines = ev[0]?.event.changes.filter((c) => c.type === GAME_LOG_ENTRY_TYPE) ?? [];
    expect(lines).toHaveLength(1);
    // Release: owner fields and card cleared; mode `own` keeping Mira's number; token unowned.
    t.setCompanion({ combatantId: g2.id, owner: null });
    const released = t.combatantRow(g2.id);
    expect(released).toMatchObject({
      ownerCharacterId: null,
      ownerPlayerId: null,
      turnMode: null,
      card: null,
      initiative: t.combatantNamed("Mira").initiative,
    });
    expect(t.tokenRow(t.tokens.goblin2).ownerPlayerId).toBeNull();
    // A PC as target → invalid; same values → ack, no event.
    expect(t.err(() => t.setCompanion({ combatantId: t.id("Mira"), owner: null })).code).toBe(
      "invalid",
    );
    const m = t.events.length;
    t.setCompanion({ combatantId: g2.id, owner: null });
    expect(t.events.length).toBe(m);
    // An owner PC without a player → invalid "Mira has no player".
    t.s.db.$client.run("PRAGMA foreign_keys = OFF");
    t.s.db.update(entity).set({ ownerPlayerId: null }).where(eq(entity.id, t.miraId)).run();
    const e = t.err(() => t.setCompanion({ combatantId: g2.id, owner: t.owner(t.miraId) }));
    expect([e.code, e.message]).toEqual(["invalid", "Mira has no player"]);
  });

  test("FR-CBT-111 pet owner and in-turn guard", () => {
    const t = cpSetup();
    const ob = t.combatantNamed("Owlbear");
    const e1 = t.err(() => t.setCompanion({ combatantId: ob.id, owner: t.owner(t.thornId) }));
    expect([e1.code, e1.message]).toEqual(["conflict", PET_OWNER_HERE]);
    const e2 = t.err(() => t.setCompanion({ combatantId: ob.id, owner: null }));
    expect([e2.code, e2.message]).toEqual(["conflict", PET_OWNER_HERE]);
    // The turn combatant (the Wolf) to in-owner-turn → conflict.
    expect(t.turnName()).toBe("Wolf");
    const e3 = t.err(() =>
      t.setCompanion({ combatantId: t.id("Wolf"), owner: t.owner(t.miraId, "in-owner-turn") }),
    );
    expect([e3.code, e3.message]).toEqual(["conflict", AFTER_ITS_TURN]);
    // Owner not in this fight → conflict; a player → forbidden.
    t.run(setRemoved.name, { combatantId: t.id("Thorn"), removed: true });
    const e4 = t.err(() =>
      t.setCompanion({ combatantId: t.id("Goblin"), owner: t.owner(t.thornId) }),
    );
    expect([e4.code, e4.message]).toEqual(["conflict", "Thorn isn't in this fight"]);
    const e5 = t.err(() =>
      t.setCompanion({ combatantId: t.id("Goblin"), owner: t.owner(t.miraId) }, t.p1),
    );
    expect(e5.code).toBe("forbidden");
  });

  test("FR-CBT-121 cap: a 9th companion of one owner → conflict", () => {
    const t = cpSetup();
    // Mira has the Owlbear; seven more monsters make eight.
    const added = t.addCombatants(
      Array.from({ length: 8 }, () => ({ definitionId: t.h.goblinId })),
    ).combatantIds;
    for (const cid of added.slice(0, 7)) {
      t.setCompanion({ combatantId: cid, owner: t.owner(t.miraId) });
    }
    const e = t.err(() =>
      t.setCompanion({ combatantId: added[7] as string, owner: t.owner(t.miraId) }),
    );
    expect(e.code).toBe("conflict");
  });
});

describe("FR-CBT-106–108 turn modes and owner states", () => {
  test("FR-CBT-107 order per turn mode", () => {
    // Unit: after-owner right after its owner (two by seq), own by its number, owner-less last.
    const pc = (id: string, init: number | null, seq: number) =>
      row(id, { kind: "pc", initiative: init, seq, entityId: `ch-${id}` });
    const comp = (
      id: string,
      seq: number,
      mode: "after-owner" | "own",
      init: number | null = null,
    ) => row(id, { seq, ownerCharacterId: "ch-mira", turnMode: mode, initiative: init });
    const m = ranks([
      row("wolf1", { initiative: 18, seq: 1 }),
      pc("mira", 15, 2),
      comp("ob5", 5, "after-owner"),
      comp("fe4", 4, "after-owner"),
      row("gob3", { initiative: 12, seq: 3 }),
      comp("fe9", 9, "own", 9),
    ]);
    expect(orderOf(m)).toEqual(["wolf1", "mira", "fe4", "ob5", "gob3", "fe9"]);
    // Owner without initiative → both last, together.
    const m0 = ranks([
      pc("mira", null, 2),
      comp("ob5", 5, "after-owner"),
      row("gob3", { seq: 3, initiative: 4 }),
    ]);
    expect(orderOf(m0)).toEqual(["gob3", "mira", "ob5"]);
    // Integration: relative order; Mira's initiative set → the Owlbear moves in the same event.
    const t = cpSetup();
    const names = t.ranked();
    expect(names.indexOf("Owlbear")).toBe(names.indexOf("Mira") + 1);
    const n = t.events.length;
    t.run(setInitiative.name, { combatantId: t.id("Mira"), value: 20 });
    const after = t.ranked();
    expect(after.slice(0, 2)).toEqual(["Mira", "Owlbear"]);
    const moved = t.events
      .slice(n)
      .flatMap((e) => e.event.changes)
      .filter((c) => c.type === COMBATANT_TYPE)
      .map((c) => (c.after as CombatantRecord).name);
    expect(moved).toContain("Owlbear");
  });

  test("FR-CBT-107 in-turn companion has no row", () => {
    const t = cpSetup();
    const drake = t.combatantNamed("Drake");
    expect([drake.position, drake.playerPosition]).toEqual([null, null]);
    expect(t.ranked()).not.toContain("Drake");
    // A full round of Next / Prev never gives it the turn.
    const seen = new Set<string>();
    for (let i = 0; i < 9; i++) {
      t.step("next");
      seen.add(t.encNow().turnCombatantId as string);
    }
    for (let i = 0; i < 4; i++) {
      t.step("prev");
      seen.add(t.encNow().turnCombatantId as string);
    }
    expect(seen.has(drake.id)).toBe(false);
    // Next onto Thorn resets the drake's movedFt (FR-CBT-40).
    t.s.db.update(combatant).set({ movedFt: 30 }).where(eq(combatant.id, drake.id)).run();
    t.nextTo("Thorn", t.encNow().round + 1);
    expect(t.combatantRow(drake.id).movedFt).toBe(0);
    // Round 0: Next doesn't count it (or the after-owner Owlbear) as "without initiative".
    const rows = t
      .combatants(t.enc.id)
      .map((c) => ({ ...c, initiative: c.kind === "monster" && c.ownerCharacterId ? null : 5 }));
    expect(stepTurn(rows, 0, null, "next").ok).toBe(true);
  });

  test("FR-CBT-108 owner active", () => {
    const t = cpSetup();
    // after-owner: its own turn right after Mira.
    t.nextTo("Mira", 1);
    t.step("next");
    expect(t.turnName()).toBe("Owlbear");
    // in-owner-turn: an effect anchored to the drake ends at the start of Thorn's turn.
    t.run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Dragon fear",
      durationRounds: 1,
      sourceCombatantId: t.id("Drake"),
    });
    const fx = () => t.active().filter((e) => e.label === "Dragon fear");
    expect(fx()).toHaveLength(1);
    t.nextTo("Thorn", 1);
    expect(fx()).toHaveLength(1);
    t.nextTo("Thorn", 2);
    expect(fx()).toHaveLength(0);
    // A `turnStart` trigger on the drake's definition fires at Thorn's turn start (FR-MOD-44).
    t.run(TRIGGER_INTENTS.putTrigger, {
      trigger: {
        definitionId: t.drake,
        name: "Ember breath",
        rule: {
          on: "turnStart",
          when: [],
          every: "each",
          // biome-ignore lint/suspicious/noThenProperty: the rule's effect field (MOD §8.4).
          then: { do: "remind", text: "breath recharges" },
        },
      },
    });
    const reminders = () =>
      t.s.db
        .select()
        .from(notification)
        .where(eq(notification.kind, MOD_TRIGGER_KIND))
        .all()
        .map((r) => r.text);
    t.nextTo("Thorn", 3);
    expect(reminders()).toEqual(["Drake: Ember breath — breath recharges"]);
  });

  test("FR-CBT-108 owner hidden", () => {
    const t = cpSetup();
    const drake = t.combatantNamed("Drake");
    const before = t.ranked();
    // An effect on the drake: hidden with it (combat-extras' hidden copy).
    t.run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: drake.id }],
      kind: "condition",
      condition: "prone",
    });
    const n = t.events.length;
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.thorn, hidden: true });
    expect(t.combatantRow(drake.id).ownerHidden).toBe(true);
    expect(t.active().find((e) => e.targetCombatantId === drake.id)?.hidden).toBe(true);
    // Players get deletes only: the drake, its effect; no upsert names it.
    for (const v of [t.p1V, t.p2V]) {
      const upserts = t.events
        .slice(n)
        .flatMap((e) => t.wire(e.event.changes, v))
        .filter((w) => typeof w !== "string" && w.op === "upsert");
      expect(JSON.stringify(upserts)).not.toContain(drake.id);
    }
    for (const v of [t.p1V, t.p2V]) {
      const w = t.events.slice(n).flatMap((e) => t.wire(e.event.changes, v));
      expect(w.filter((c) => typeof c !== "string" && c.id === drake.id)).toEqual([
        { type: COMBATANT_TYPE, id: drake.id, op: "delete" },
      ]);
      expect(t.playerCombatant(v, drake.id)).toBeUndefined();
    }
    // DM order unchanged.
    expect(t.ranked()).toEqual(before);
    // Reveal → back (FR-CBT-116).
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.thorn, hidden: false });
    expect(t.combatantRow(drake.id).ownerHidden).toBe(false);
    expect(t.playerCombatant(t.p2V, drake.id)).toMatchObject({ ownerPlayerId: t.h.p2.id });
  });

  test("FR-CBT-108 owner removed", () => {
    const t = cpSetup();
    const drake = t.combatantNamed("Drake");
    t.nextTo("Wolf", 2);
    t.run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "custom",
      label: "Dragon fear",
      durationRounds: 1,
      sourceCombatantId: drake.id,
    });
    t.run(setRemoved.name, { combatantId: t.id("Thorn"), removed: true });
    const d = t.combatantRow(drake.id);
    expect(d.position).not.toBeNull();
    // It takes Thorn's slot: right after Thorn, before the Elite.
    const names = t.ranked();
    expect(names.indexOf("Drake")).toBe(names.indexOf("Thorn") + 1);
    t.nextTo("Drake", 2);
    expect(t.turnName()).toBe("Drake");
    // Initiative never null after round 0: it ranks by Thorn's (kept) number.
    expect(t.combatants(t.enc.id).every((c) => c.kind !== "pc" || c.initiative !== null)).toBe(
      true,
    );
    // Its anchored effect ends at the start of its own turn (round 3).
    t.nextTo("Drake", 3);
    expect(t.active().filter((e) => e.label === "Dragon fear")).toHaveLength(0);
    // Restore → back inside Thorn's turn from the next Next.
    t.run(setRemoved.name, { combatantId: t.id("Thorn"), removed: false });
    expect(t.combatantRow(drake.id).position).not.toBeNull();
    t.step("next");
    expect(t.combatantRow(drake.id).position).toBeNull();
  });

  test("FR-CBT-108 owner dead", () => {
    const t = cpSetup();
    const drake = t.combatantNamed("Drake");
    // A dying Thorn at 0 HP (not dead): the drake stays inside her turn.
    t.s.db.update(entity).set({ hpCurrent: 0 }).where(eq(entity.id, t.thornId)).run();
    t.nextTo("Thorn", 1);
    expect(t.combatantRow(drake.id).position).toBeNull();
    // Dead (3 failures, FR-CBTX-25) → as removed: its own turn in her slot from the next Next.
    t.s.db.update(entity).set({ deathFailures: 3 }).where(eq(entity.id, t.thornId)).run();
    t.step("next");
    expect(t.combatantRow(drake.id).position).not.toBeNull();
    t.nextTo("Drake", 2);
    expect(t.turnName()).toBe("Drake");
  });

  test("FR-CBT-108 owner without initiative", () => {
    // Round 0: owner and after-owner companion sort last together; Start round 1 doesn't count
    // the companion as missing.
    const rows = [
      {
        id: "mira",
        position: 2,
        kind: "pc" as const,
        removed: false,
        hpCurrent: 10,
        initiative: 9,
      },
      {
        id: "ob",
        position: 3,
        kind: "monster" as const,
        removed: false,
        hpCurrent: 59,
        initiative: null,
        turnMode: "after-owner" as const,
      },
      {
        id: "dr",
        position: null,
        kind: "monster" as const,
        removed: false,
        hpCurrent: 9,
        initiative: null,
        turnMode: "in-owner-turn" as const,
      },
      {
        id: "gob",
        position: 1,
        kind: "monster" as const,
        removed: false,
        hpCurrent: 7,
        initiative: 12,
      },
    ];
    expect(stepTurn(rows, 0, null, "next")).toEqual({ ok: true, round: 1, turnCombatantId: "gob" });
    expect(unrolledMonsters(rows).map((r) => r.id)).toEqual([]);
  });

  test("FR-CBT-108 who rolls", () => {
    const t = cpSetup({ round1: false });
    const ob = t.combatantNamed("Owlbear");
    expect(t.err(() => t.run(rollInitiative.name, { combatantIds: [ob.id] }, t.p1)).code).toBe(
      "forbidden",
    );
    // Start rolled no initiative for the after-owner / in-owner-turn pets.
    expect([ob.initiative, t.combatantNamed("Drake").initiative]).toEqual([null, null]);
    // An `own` companion lacking one is listed by "Roll monsters"; the others never. (With an
    // owner number it keeps that one instead, FR-CBT-106: here a fresh start, Mira has none.)
    const r0 = cpSetup({ start: false });
    r0.run("cbt.start", { encounterId: r0.enc.id, sceneId: r0.sceneId, petIds: [r0.owlbear] });
    r0.setCompanion({ combatantId: r0.id("Owlbear"), owner: r0.owner(r0.miraId, "own") });
    expect(unrolledMonsters(r0.combatants(r0.enc.id)).map((c) => c.name)).toEqual(["Owlbear"]);
  });

  test("FR-CBT-106 mode change lasts for that fight", () => {
    const t = cpSetup();
    t.setCompanion({ combatantId: t.id("Owlbear"), owner: t.owner(t.miraId, "in-owner-turn") });
    expect(t.combatantNamed("Owlbear").turnMode).toBe("in-owner-turn");
    t.endEncounter();
    expect(t.entityRow(t.owlbear)).toMatchObject({ turnMode: "after-owner" });
  });
});

describe("FR-CBT-109 / -113 pets at Start and End", () => {
  test("FR-CBT-109 pets join at Start", () => {
    const t = cpSetup({ start: false });
    // A kept HP below max (as `pet.adjustHp` leaves it, FR-ENT-36).
    t.s.db.update(entity).set({ hpCurrent: 45 }).where(eq(entity.id, t.owlbear)).run();
    // A pet of a non-joining PC → invalid (Thorn left out).
    const bad = t.err(() =>
      t.run("cbt.start", {
        encounterId: t.enc.id,
        sceneId: t.sceneId,
        excludeCharacterIds: [t.thornId],
        petIds: [t.drake],
      }),
    );
    expect(bad.code).toBe("invalid");
    t.start();
    const ob = t.combatantNamed("Owlbear");
    expect(ob).toMatchObject({
      kind: "monster",
      pet: true,
      tokenId: t.petTokens.owlbear,
      hpCurrent: 45,
      hpMax: 59,
      turnMode: "after-owner",
      ownerPlayerId: t.h.p1.id,
      side: "ally",
    });
    expect(ob.card?.attacks.map((a) => a.name)).toEqual(["Beak", "Claws"]);
    // The drake sits inside Thorn's turn.
    expect(t.combatantNamed("Drake").position).toBeNull();
  });

  test("FR-CBT-113 summon HP gone after End, pet HP kept", () => {
    const t = cpSetup();
    // Goblin 2 made Mira's companion (a summon by the rule `ownerPlayerId ∧ ¬pet`).
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    t.run(applyHp.name, { combatantId: t.id("Owlbear"), kind: "damage", amount: 39 });
    expect(t.combatantNamed("Owlbear").hpCurrent).toBe(20);
    const n = t.events.length;
    t.endEncounter();
    expect(t.entityRow(t.owlbear)).toMatchObject({ hpCurrent: 20, petPresent: true });
    // The summon's token is deleted (FR-MAP-79); the pet keeps its token.
    const ended = t.events.slice(n).find((e) => e.event.type === "EncounterEnded")?.event;
    expect(
      ended?.changes.filter((c) => c.type === TOKEN_TYPE && c.after === null).map((c) => c.id),
    ).toEqual([t.tokens.goblin2]);
    expect(t.tokenRow(t.petTokens.owlbear).id).toBe(t.petTokens.owlbear);
    // A new encounter with the Owlbear (same DB): its combatant starts at 20.
    const enc2 = t.createAmbush();
    t.run("cbt.start", { encounterId: enc2.id, sceneId: t.sceneId, petIds: [t.owlbear] });
    expect(t.byName(enc2.id).Owlbear?.hpCurrent).toBe(20);
  });
});

describe("FR-CBT-112 Undo after Dismiss", () => {
  test("FR-CBT-112 undo after dismiss refused whole", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const { hpChangeId } = t.run<{ hpChangeId: string }>(applyHp.name, {
      combatantId: ob,
      kind: "damage",
      amount: 5,
    });
    // Dismissed (CP3's `cbt.dismiss` sets `active` false; the guard reads only that).
    t.s.db.update(combatant).set({ active: false }).where(eq(combatant.id, ob)).run();
    const n = t.events.length;
    const e = t.err(() => t.run(undoCommand.name, { expectedHpChangeId: hpChangeId }));
    expect([e.code, e.message]).toEqual(["conflict", UNDO_DISMISSED]);
    expect(t.events.length).toBe(n);
  });
});

describe("FR-CBT-114 the owner attacks", () => {
  test("FR-CBT-114 owner attacks via the DM popup", () => {
    const t = cpSetup();
    const ob = t.combatantNamed("Owlbear");
    const claws = ob.card?.attacks.find((a) => a.name === "Claws")?.id as string;
    const r = t.run<AttackResult>(
      attackCommand.name,
      { attackerId: ob.id, attackId: claws, manual: [{ diceTotal: 12 }, { diceTotal: 9 }] },
      t.p1,
    );
    const card = t.s.db.select().from(notification).where(eq(notification.id, r.cardId)).get();
    expect(card).toMatchObject({ audience: "player", audiencePlayerId: t.h.p1.id });
    const p = DamageCardPayload.parse(card?.payload);
    expect([p.attackName, p.damageType, p.attackId]).toEqual(["Claws", "slashing", claws]);
    expect(card?.text).toBe("Owlbear: 19 to hit, 14 slashing");
    // Another player → forbidden; an attackId not on the card → not_found.
    expect(t.err(() => t.run(attackCommand.name, { attackerId: ob.id }, t.p2)).code).toBe(
      "forbidden",
    );
    expect(
      t.err(() => t.run(attackCommand.name, { attackerId: ob.id, attackId: "nope" }, t.p1)).code,
    ).toBe("not_found");
    // A hidden companion → not_found.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.petTokens.owlbear, hidden: true });
    expect(t.err(() => t.run(attackCommand.name, { attackerId: ob.id }, t.p1)).code).toBe(
      "not_found",
    );
  });

  test("FR-CBT-114 an imported definition's id-less row rolls by its card id", () => {
    const t = cpSetup();
    const g2 = t.id("Goblin 2");
    t.setCompanion({ combatantId: g2, owner: t.owner(t.miraId) });
    const row = t.combatantRow(g2).card?.attacks[0];
    expect(row?.name).toBe("Scimitar");
    const r = t.run<AttackResult>(
      attackCommand.name,
      { attackerId: g2, attackId: row?.id, manual: [{ diceTotal: 10 }, { diceTotal: 3 }] },
      t.p1,
    );
    const card = t.s.db.select().from(notification).where(eq(notification.id, r.cardId)).get();
    expect(DamageCardPayload.parse(card?.payload).attackName).toBe("Scimitar");
  });

  test("FR-CBT-114 roll lines DM and owner only", () => {
    const t = cpSetup();
    const ob = t.combatantNamed("Owlbear");
    const n = t.events.length;
    const r = t.run<AttackResult>(
      attackCommand.name,
      { attackerId: ob.id, manual: [{ diceTotal: 12 }, { diceTotal: 9 }] },
      t.p1,
    );
    const entry = t.logRows().at(-1);
    expect(entry).toMatchObject({
      public: false,
      audiencePlayerId: t.h.p1.id,
      actorName: "Owlbear",
    });
    const own = t.framesSince(n, t.p1V);
    const other = t.framesSince(n, t.p2V);
    expect(own).toContain(entry?.id as string);
    expect(other).not.toContain(entry?.id as string);
    // The DM applies: the outcome line keeps the total, never the "N + M" split.
    t.run("cbt.applyCard", {
      cardId: r.cardId,
      toHitTotal: 19,
      damageTotal: 14,
      targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
      damageRollId: DamageCardPayload.parse(
        t.s.db.select().from(notification).where(eq(notification.id, r.cardId)).get()?.payload,
      ).damage?.rollId as string,
    });
    const outcome = t.logRows().at(-1);
    const payload = outcome?.payload as { toHit: { dice: number | null; constant: number } };
    expect(payload.toHit).toMatchObject({ dice: null, constant: 0, total: 19 });
    const text = lineText(
      attackLogKind.formatLine({ actorName: "Owlbear", payload: outcome?.payload } as never),
    );
    expect(text).toBe("Owlbear attacks Goblin: 19 — DM: hit. 14 piercing damage (physical)");
    expect(text).not.toContain("+ 7");
  });
});

describe("FR-CBT-116 visibility", () => {
  test("FR-CBT-116 other players get a band only", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const other = t.playerCombatant(t.p2V, ob) as Record<string, unknown>;
    expect(other).toMatchObject({
      band: "healthy",
      ownerCharacterId: t.miraId,
      ownerPlayerId: t.h.p1.id,
      turnMode: "after-owner",
    });
    for (const k of [
      "card",
      "hpCurrent",
      "hpMax",
      "tempHp",
      "pet",
      "ownerHidden",
      "concentrationEffectId",
    ]) {
      expect(Object.keys(other)).not.toContain(k);
    }
    const own = t.playerCombatant(t.p1V, ob) as Record<string, unknown>;
    expect(own).toMatchObject({ hpCurrent: 59, hpMax: 59, tempHp: 0, pet: true });
    expect((own.card as { ac: number }).ac).toBe(13);
    expect(Object.keys(own)).not.toContain("ownerHidden");
    expect(Object.keys(own)).not.toContain("concentrationEffectId");
    const dm = (t.snap(t.dmV, COMBATANT_TYPE) as Record<string, unknown>[]).find(
      (c) => c.id === ob,
    );
    expect(Object.keys(dm ?? {})).toContain("concentrationEffectId");
    // A hidden companion reaches no player, the owner included.
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.petTokens.owlbear, hidden: true });
    expect(t.playerCombatant(t.p1V, ob)).toBeUndefined();
    expect(t.playerCombatant(t.p2V, ob)).toBeUndefined();
  });
});

describe("FR-CBT-117 card copy", () => {
  test("FR-CBT-117 card follows the definition", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const card0 = t.combatantRow(ob).card;
    const clawsId = card0?.attacks[1]?.id as string;
    const pet = t.entityRow(t.owlbear);
    if (pet.kind !== "monster") throw new Error("pet");
    const put = (attacks: typeof pet.statBlock.attacks) =>
      t.run("entities.update", {
        id: t.owlbear,
        name: pet.name,
        statBlock: { ...pet.statBlock, attacks },
        companionOf: pet.companionOf,
        turnMode: pet.turnMode,
      });
    const n = t.events.length;
    put(pet.statBlock.attacks.map((a) => (a.name === "Claws" ? { ...a, toHit: 8 } : a)));
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes.some((c) => c.type === COMBATANT_TYPE && c.id === ob)).toBe(true);
    expect(t.combatantRow(ob).card?.attacks[1]).toMatchObject({ id: clawsId, toHit: 8 });
    // A row inserted before it: its id still names Claws (the pet's rows carry ids).
    const now = t.entityRow(t.owlbear);
    if (now.kind !== "monster") throw new Error("pet");
    put([{ name: "Tail", toHit: 2, damage: "1d4" }, ...now.statBlock.attacks]);
    expect(t.combatantRow(ob).card?.attacks.find((a) => a.id === clawsId)?.name).toBe("Claws");
    expect(t.events.length).toBeGreaterThan(n);
  });
});

describe("FR-CBT-122 cbt.companion lines", () => {
  test("FR-CBT-122 lines", () => {
    const line = (payload: unknown, dm?: unknown) =>
      lineText(
        companionLogKind.formatLine({
          actorName: "DM",
          payload,
          ...(dm ? { dmPayload: dm } : {}),
        } as never),
      );
    expect(line({ action: "summon", name: "Fire Elemental", ownerName: "Mira", count: 2 })).toBe(
      "Mira summons Fire Elemental ×2",
    );
    expect(line({ action: "dismiss", name: "Fire Elemental" })).toBe("Fire Elemental is dismissed");
    expect(line({ action: "follows", name: "Owlbear", ownerName: "Brakka" })).toBe(
      "Owlbear now follows Brakka",
    );
    expect(line({ action: "hostile", name: "Fire Elemental" })).toBe(
      "Fire Elemental turns hostile",
    );
    expect(
      line(
        { action: "follows", name: "Owlbear", ownerName: "Brakka" },
        { turnMode: "in-owner-turn" },
      ),
    ).toBe("DM — Owlbear now follows Brakka (in Brakka's turn)");
    // Hidden companion → DM-only line.
    const t = cpSetup();
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.goblin2, hidden: true });
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    expect(t.logRows().at(-1)).toMatchObject({ kind: "cbt.companion", public: false });
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.goblin2, hidden: false });
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: null, side: "enemy" });
    expect(t.logRows().at(-1)).toMatchObject({
      kind: "cbt.companion",
      public: true,
      payload: { action: "hostile", name: "Goblin 2", ownerName: "Mira" },
    });
    expect(t.combatantRow(t.id("Goblin 2"))).toMatchObject({ side: "enemy", publicSide: "enemy" });
  });
});

describe("FR-CBT-116 leak scan per player (CP0)", () => {
  test("FR-CBT-116 leak scan: player-2's frames and snapshots never carry the Owlbear's numbers, card, roll lines or DM-only fields", () => {
    const t = cpSetup();
    const n = t.events.length;
    const ob = t.combatantNamed("Owlbear");
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: ob.id, manual: [{ diceTotal: 12 }, { diceTotal: 9 }] },
      t.p1,
    );
    t.run(applyHp.name, { combatantId: ob.id, kind: "damage", amount: 14 });
    t.run(MAP_INTENTS.setTokenHidden, { tokenId: t.tokens.thorn, hidden: true });
    const leaks = [
      '"card"',
      "ownerHidden",
      "concentrationEffectId",
      "Beak",
      "Claws",
      '"hpMax":59',
      "2d8+5",
      "1d10+5",
    ];
    const p2 = t.framesSince(n, t.p2V) + JSON.stringify(t.h.snapshot(t.p2V));
    for (const leak of leaks)
      expect({ leak, found: p2.includes(leak) }).toEqual({ leak, found: false });
    // The owner never sees DM-only fields or the drake of hidden Thorn.
    const p1 = t.framesSince(n, t.p1V) + JSON.stringify(t.h.snapshot(t.p1V));
    for (const leak of ["ownerHidden", "concentrationEffectId"]) {
      expect({ leak, found: p1.includes(leak) }).toEqual({ leak, found: false });
    }
    // `derivedFromId` never on the owner's pet rows (characters carry theirs as before).
    const petRows = t.events
      .slice(n)
      .flatMap((e) => t.wire(e.event.changes, t.p1V))
      .filter((w) => typeof w !== "string" && w.type === ENTITY_TYPE && w.id === t.owlbear);
    for (const w of petRows) expect(JSON.stringify(w)).not.toContain("derivedFromId");
    expect(t.playerCombatant(t.p1V, t.id("Drake"))).toBeUndefined();
    expect(t.playerCombatant(t.p2V, t.id("Drake"))).toBeUndefined();
    // Player 1's own entity view of the Owlbear: full, minus derivedFromId / petPresent.
    const own = t.playerEntity(t.p1V, t.owlbear) as Record<string, unknown>;
    expect(Object.keys(own)).not.toContain("derivedFromId");
    expect(Object.keys(own)).not.toContain("petPresent");
    expect(t.playerEntity(t.p2V, t.owlbear)).toEqual({
      id: t.owlbear,
      kind: "monster",
      name: "Owlbear",
      portraitAssetId: null,
      ownerPlayerId: t.h.p1.id,
      companionOf: t.miraId,
      // In a fight the HP lives on the combatant (its band there); the pet row keeps its own.
      band: "healthy",
    });
  });
});
