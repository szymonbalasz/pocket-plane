// Sprint 6 CP3 (CBT §13.3): `cbt.summon` (FR-CBT-110, -121; FR-MAP-75), `cbt.dismiss`
// (FR-CBT-112), End's token removal for summons only (FR-CBT-113, #295).
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { companionLogKind } from "@shared/combat-tracker/companion-kind";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { CompanionDismissed, CompanionsSummoned } from "@shared/events/combat-tracker";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { combatant, effect, entity, token } from "../../db/schema";
import { createEntity } from "../entities/commands";
import { thornBlock } from "../entities/testing";
import { PRESS_NEXT_FIRST } from "./dismiss";
import { applyHp, UNDO_DISMISSED, undoCommand } from "./hp";
import { combatRuleHooksOf } from "./rule-hooks";
import { PETS_JOIN_AS_THEMSELVES } from "./summon";
import { summonSetup } from "./summon-testing";

const tokenRows = (t: ReturnType<typeof summonSetup>) => t.s.db.select().from(token).all();

describe("FR-CBT-110 cbt.summon", () => {
  test("FR-CBT-110 summon: Fire Elemental ×2 for Mira beside her token, after-owner, average HP, one line, CompanionsSummoned (tokens first)", () => {
    const t = summonSetup();
    const n = t.events.length;
    const ids = t.summon({ count: 2 });
    expect(ids).toHaveLength(2);
    const [a, b] = ids.map((id) => t.combatantRow(id));
    for (const c of [a, b]) {
      expect(c).toMatchObject({
        kind: "monster",
        entityId: t.fe,
        active: true,
        ownerCharacterId: t.miraId,
        ownerPlayerId: t.h.p1.id,
        turnMode: "after-owner",
        pet: false,
        summoned: true,
        hpCurrent: 102,
        hpMax: 102,
        side: "ally",
        publicSide: "ally",
        hidden: false,
        concentrationEffectId: null,
      });
      expect(c?.card?.attacks.map((x) => x.name)).toEqual(["Touch"]);
      // FR-MAP-75: an owned token (owner = Mira's player) next to Mira's (2, 7).
      const tok = t.tokenRow(c?.tokenId as string);
      expect(tok.ownerPlayerId).toBe(t.h.p1.id);
      expect(Math.abs(tok.col - 2)).toBeLessThanOrEqual(3);
      expect(Math.abs(tok.row - 7)).toBeLessThanOrEqual(3);
    }
    expect([a?.name, b?.name]).toEqual(["Fire Elemental", "Fire Elemental 2"]);
    // Relative order: Mira → Owlbear → Fire Elemental → Fire Elemental 2 (FR-CBT-107, review 19).
    const order = t.ranked();
    const at = (name: string) => order.indexOf(name);
    expect(at("Owlbear")).toBe(at("Mira") + 1);
    expect(at("Fire Elemental")).toBe(at("Owlbear") + 1);
    expect(at("Fire Elemental 2")).toBe(at("Fire Elemental") + 1);
    const evs = t.events.slice(n).map((e) => e.event);
    expect(evs.map((e) => e.type)).toEqual([CompanionsSummoned.type]);
    const ev = evs[0];
    expect(ev?.payload).toEqual({
      encounterId: t.enc.id,
      combatantIds: ids,
      ownerCharacterId: t.miraId,
    });
    const types = ev?.changes.map((c) => c.type) ?? [];
    expect(types.lastIndexOf(TOKEN_TYPE)).toBeLessThan(types.indexOf(COMBATANT_TYPE));
    // One `cbt.companion` line: players read "Mira summons Fire Elemental ×2".
    const lines = ev?.changes.filter((c) => c.type === GAME_LOG_ENTRY_TYPE) ?? [];
    expect(lines).toHaveLength(1);
    const line = lines[0]?.after as Parameters<typeof companionLogKind.formatLine>[0] & {
      public: boolean;
    };
    expect(line.public).toBe(true);
    expect(lineText(companionLogKind.formatLine({ ...line, dmPayload: null }))).toBe(
      "Mira summons Fire Elemental ×2",
    );
    // `CompanionsSummoned` is logged; not undoable.
    expect(t.logTypes()).toContain(CompanionsSummoned.type);
  });

  test("FR-CBT-110 summon HP per hpMode: rolled = the formula, a DM-only roll entry; own rolls initiative DM-only; in-owner-turn has no rank", () => {
    const t = summonSetup();
    const [rolled] = t.summon({ hpMode: "rolled", turnMode: "own" });
    const c = t.combatantRow(rolled as string);
    expect(c.hpCurrent).toBe(c.hpMax);
    expect(c.hpCurrent).toBeGreaterThanOrEqual(48);
    expect(c.hpCurrent).toBeLessThanOrEqual(156);
    expect(c.initiative).not.toBeNull();
    // FR-CBT-69: the `own` summon's initiative line and the HP roll are DM-only.
    const p2Frames = t.framesSince(0, t.p2V);
    expect(p2Frames).not.toContain("HP (12d10+36)");
    const [inTurn] = t.summon({ turnMode: "in-owner-turn" });
    expect(t.combatantRow(inTurn as string)).toMatchObject({ position: null, initiative: null });
  });

  test("FR-CBT-110 summon errors: no fight, owner not in it, no player, pet, count, concentration, player", () => {
    const t = summonSetup();
    const code = (fn: () => unknown) => t.err(fn).code;
    // A pet as definition → invalid "Pets join as themselves".
    const pet = t.err(() => t.summon({ definitionId: t.owlbear }));
    expect([pet.code, pet.message]).toEqual(["invalid", PETS_JOIN_AS_THEMSELVES]);
    // count outside 1–8 → invalid (zod).
    expect(code(() => t.summon({ count: 9 }))).toBe("invalid");
    expect(code(() => t.summon({ count: 0 }))).toBe("invalid");
    // linkConcentration while Mira isn't concentrating → invalid.
    const conc = t.err(() => t.summon({ linkConcentration: true }));
    expect([conc.code, conc.message]).toEqual(["invalid", "Mira isn't concentrating"]);
    // player-1 sending it → forbidden.
    expect(code(() => t.summon({}, t.p1))).toBe("forbidden");
    // Mira removed (not in this fight) → conflict "Mira isn't in this fight".
    t.run("cbt.setRemoved", { combatantId: t.id("Mira"), removed: true });
    const out = t.err(() => t.summon());
    expect([out.code, out.message]).toEqual(["conflict", "Mira isn't in this fight"]);
    t.run("cbt.setRemoved", { combatantId: t.id("Mira"), removed: false });
    // A PC without a player (its player left, as the DB allows) → invalid "Brakka has no player".
    const brakka = t.run<{ id: string }>(createEntity.name, {
      kind: "character",
      name: "Brakka",
      ownerPlayerId: t.h.p1.id,
      statBlock: thornBlock,
    }).id;
    t.addCombatants([{ characterId: brakka }]);
    t.s.db.update(entity).set({ ownerPlayerId: null }).where(eq(entity.id, brakka)).run();
    const np = t.err(() => t.summon({ ownerCharacterId: brakka }));
    expect([np.code, np.message]).toEqual(["invalid", "Brakka has no player"]);
    // Nothing was written by any refused summon.
    expect(t.combatants(t.enc.id).filter((c) => c.summoned)).toEqual([]);
    // After End: no started encounter → conflict.
    t.endEncounter();
    expect(code(() => t.summon())).toBe("conflict");
  });

  test("FR-CBT-121 caps: a 9th companion of one owner → conflict (pets count)", () => {
    const t = summonSetup();
    // Mira has the Owlbear: 7 more fit, an 8th summon doesn't.
    expect(t.summon({ count: 7 })).toHaveLength(7);
    const e = t.err(() => t.summon());
    expect([e.code, e.message]).toEqual(["conflict", "Mira already has 8 companions"]);
    expect(t.combatants(t.enc.id).filter((c) => c.summoned)).toHaveLength(7);
  });

  test("FR-CBT-110 one transaction: a throwing added hook → no token, combatant, roll or line", () => {
    const t = summonSetup();
    combatRuleHooksOf(t.s).register("test.fail", {
      added: () => {
        throw conflict("hook failed");
      },
    });
    const counts = () => [
      tokenRows(t).length,
      t.count("combatant"),
      t.count("roll"),
      t.count("game_log_entry"),
    ];
    const before = counts();
    expect(t.err(() => t.summon({ count: 2, hpMode: "rolled", turnMode: "own" })).code).toBe(
      "conflict",
    );
    expect(counts()).toEqual(before);
    combatRuleHooksOf(t.s).unregister("test.fail");
  });

  test("FR-MAP-75 summon placement: free cells next to the owner's token; no owner token → at; no scene → token-less", () => {
    const t = summonSetup();
    const [x] = t.summon({ count: 1 });
    const tok = t.tokenRow(t.combatantRow(x as string).tokenId as string);
    // Mira at (2, 7) medium; a large summon on the nearest free 2 × 2 block (not on her cell).
    expect(tok.col === 2 && tok.row === 7).toBe(false);
    expect(Math.max(Math.abs(tok.col - 2), Math.abs(tok.row - 7))).toBeLessThanOrEqual(2);
    // Thorn's token unbound → the DM's `at` (FR-CBT-65).
    t.s.db
      .update(combatant)
      .set({ tokenId: null })
      .where(eq(combatant.id, t.id("Thorn")))
      .run();
    const [y] = t.summon({ ownerCharacterId: t.thornId, at: { col: 20, row: 2 } });
    const ty = t.tokenRow(t.combatantRow(y as string).tokenId as string);
    expect(Math.max(Math.abs(ty.col - 20), Math.abs(ty.row - 2))).toBeLessThanOrEqual(2);
    expect(ty.ownerPlayerId).toBe(t.h.p2.id);
  });

  test("FR-CBT-110 hidden summon: reaches no player, the owner included; its line is DM-only", () => {
    const t = summonSetup();
    const n = t.events.length;
    const [h] = t.summon({ hidden: true });
    const c = t.combatantRow(h as string);
    expect(c.hidden).toBe(true);
    expect(t.tokenRow(c.tokenId as string).hidden).toBe(true);
    for (const v of [t.p1V, t.p2V]) {
      expect(t.framesSince(n, v)).not.toContain(h as string);
      expect(t.playerCombatant(v, h as string)).toBeUndefined();
    }
  });
});

describe("FR-CBT-112 cbt.dismiss", () => {
  test("FR-CBT-112 dismiss: summon inactive, token deleted, effects ended, line, CompanionDismissed; pet HP written back, token kept", () => {
    const t = summonSetup();
    const [fe] = t.summon();
    const feRow = t.combatantRow(fe as string);
    t.run(CBTX_INTENTS.addEffect, {
      targets: [{ combatantId: fe }],
      kind: "condition",
      condition: "prone",
    });
    const n = t.events.length;
    t.dismiss({ combatantId: fe as string });
    expect(t.combatantRow(fe as string).active).toBe(false);
    expect(
      t.s.db
        .select()
        .from(token)
        .where(eq(token.id, feRow.tokenId as string))
        .all(),
    ).toEqual([]);
    const effects = t.s.db
      .select()
      .from(effect)
      .where(eq(effect.targetCombatantId, fe as string))
      .all();
    expect(effects.map((e) => e.endedReason)).toEqual(["removed"]);
    const ev = t.events
      .slice(n)
      .map((e) => e.event)
      .find((e) => e.type === CompanionDismissed.type);
    expect(ev?.payload).toEqual({ encounterId: t.enc.id, combatantId: fe, by: "dm" });
    const types = ev?.changes.map((c) => `${c.type}:${c.after === null ? "del" : "up"}`) ?? [];
    expect(types).toContain(`${TOKEN_TYPE}:del`);
    const line = ev?.changes.find((c) => c.type === GAME_LOG_ENTRY_TYPE)?.after as never;
    expect(
      lineText(companionLogKind.formatLine({ ...(line as object), dmPayload: null } as never)),
    ).toBe("Fire Elemental is dismissed");
    // Players get the combatant delete.
    for (const v of [t.p1V, t.p2V]) {
      const w = t.wire(ev?.changes ?? [], v).find((c) => c.id === fe);
      expect(w).toMatchObject({ op: "delete" });
    }
    // Pet: HP written back, token kept.
    t.run(applyHp.name, { combatantId: t.id("Owlbear"), kind: "damage", amount: 19 });
    t.dismiss({ combatantId: t.id("Owlbear") });
    expect(t.entityRow(t.owlbear).hpCurrent).toBe(40);
    expect(t.tokenRow(t.petTokens.owlbear).id).toBe(t.petTokens.owlbear);
  });

  test("FR-CBT-112 dismiss guards: turn combatant, owner rights, second dismiss, not a companion", () => {
    const t = summonSetup();
    const [mine] = t.summon();
    const [thorns] = t.summon({ ownerCharacterId: t.thornId });
    // Owner dismissing their own summon ✓; their pet → forbidden; another's → forbidden.
    expect(t.err(() => t.dismiss({ combatantId: t.id("Owlbear") }, t.p1)).code).toBe("forbidden");
    expect(t.err(() => t.dismiss({ combatantId: thorns as string }, t.p1)).code).toBe("forbidden");
    const n = t.events.length;
    t.dismiss({ combatantId: mine as string }, t.p1);
    expect(
      t.events.slice(n).find((e) => e.event.type === CompanionDismissed.type)?.event.payload,
    ).toMatchObject({
      by: t.h.p1.id,
    });
    // Second dismiss (two tabs / DM and owner at once) → invalid.
    expect(t.err(() => t.dismiss({ combatantId: mine as string })).code).toBe("invalid");
    expect(t.err(() => t.dismiss({ combatantId: mine as string }, t.p1)).code).toBe("invalid");
    // Not a companion → invalid.
    const g = t.err(() => t.dismiss({ combatantId: t.id("Goblin") }));
    expect([g.code, g.message]).toEqual(["invalid", "Only companions can be dismissed"]);
    // The turn combatant → conflict "Press Next first".
    t.nextTo("Fire Elemental 2", 1);
    const turn = t.err(() => t.dismiss({ combatantId: thorns as string }));
    expect([turn.code, turn.message]).toEqual(["conflict", PRESS_NEXT_FIRST]);
  });

  test("FR-CBT-112 undo after dismiss: damage on the Fire Elemental, then Dismiss → Undo refused whole, nothing written", () => {
    const t = summonSetup();
    const [fe] = t.summon();
    const { hpChangeId } = t.run<{ hpChangeId: string }>(applyHp.name, {
      combatantId: fe,
      kind: "damage",
      amount: 10,
    });
    t.dismiss({ combatantId: fe as string });
    const before = t.combatantRow(fe as string);
    const e = t.err(() => t.run(undoCommand.name, { expectedHpChangeId: hpChangeId }));
    expect([e.code, e.message]).toEqual(["conflict", UNDO_DISMISSED]);
    expect(t.combatantRow(fe as string)).toEqual(before);
  });

  test("FR-CBT-112 a companion made with setCompanion keeps its token (no owner) at Dismiss", () => {
    const t = summonSetup();
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    expect(t.tokenRow(t.tokens.goblin2).ownerPlayerId).toBe(t.h.p1.id);
    t.dismiss({ combatantId: t.id("Goblin 2") });
    expect(t.tokenRow(t.tokens.goblin2)).toMatchObject({ ownerPlayerId: null });
  });
});

describe("FR-CBT-113 End", () => {
  test("FR-CBT-113 summon HP gone after End, pet HP kept: summon tokens deleted, a charmed companion's kept", () => {
    const t = summonSetup();
    const [fe] = t.summon();
    const feTok = t.combatantRow(fe as string).tokenId as string;
    t.setCompanion({ combatantId: t.id("Goblin 2"), owner: t.owner(t.miraId) });
    t.run(applyHp.name, { combatantId: t.id("Owlbear"), kind: "damage", amount: 39 });
    t.run(applyHp.name, { combatantId: fe, kind: "damage", amount: 52 });
    const n = t.events.length;
    t.endEncounter();
    expect(t.entityRow(t.owlbear).hpCurrent).toBe(20);
    const ended = t.events.slice(n).find((e) => e.event.type === "EncounterEnded")?.event;
    expect(
      ended?.changes.filter((c) => c.type === TOKEN_TYPE && c.after === null).map((c) => c.id),
    ).toEqual([feTok]);
    // The Owlbear and the charmed Goblin 2 keep their tokens (the goblin's without an owner).
    expect(t.tokenRow(t.petTokens.owlbear).id).toBe(t.petTokens.owlbear);
    expect(t.tokenRow(t.tokens.goblin2).ownerPlayerId).toBeNull();
    expect(t.combatantRow(fe as string).active).toBe(false);
    // A new encounter with the Owlbear (same DB): it starts at 20.
    const enc2 = t.createAmbush();
    t.run("cbt.start", { encounterId: enc2.id, sceneId: t.sceneId, petIds: [t.owlbear] });
    expect(t.byName(enc2.id).Owlbear?.hpCurrent).toBe(20);
    // A client reload (fresh snapshot): player-1 holds the pet at 20.
    expect(t.playerEntity(t.p1V, t.owlbear)).toMatchObject({ hpCurrent: 20 });
    expect(t.snap(t.dmV, ENTITY_TYPE).length).toBeGreaterThan(0);
  });
});
