// Apply hooks (FR-MOD-38, -41, ADR-0043; R0): the registry is created empty; `cbt.applyCard` runs
// every hook per target before `hpRules.apply` in its transaction (extra raw summed into the one
// apply, line parts, DM facts, hp_change `triggerParts`, effective AC, rows in `AttackApplied`);
// `cbt.undo` runs `revert` per undone row before the card is reopened. Stub hooks only.
import { describe, expect, test } from "bun:test";
import { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type HpChangeRecord,
  type HpChangesResult,
  parseFullCard,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import { eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { combatant, gameLogEntry, hpChange, notification } from "../../db/schema";
import {
  type ApplyHook,
  ApplyHooks,
  applyHooks,
  applyHooksOf,
  bindApplyHooks,
} from "./apply-hooks";
import { attackCommand } from "./attack";
import { applyCard, undoCommand } from "./hp";
import { startCommand } from "./lifecycle";
import { toCombatantRecord } from "./rows";
import { combatSetup } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const hooks = applyHooksOf(t.s);
  // These tests drive stub hooks alone: MOD's registry line (R4) has its own tests.
  hooks.unregister("effect-modifiers.triggers");
  const attack = (name: string, toHit: number, damage: number) =>
    t.run<{ cardId: string }>(attackCommand.name, {
      attackerId: id(name),
      manual: [{ diceTotal: toHit }, { diceTotal: damage }],
    }).cardId;
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
  const apply = (cardId: string, targets: Record<string, unknown>[]) => {
    const p = parseFullCard(card(cardId)?.payload);
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      damageRollId: p.damage.rollId,
      partRollIds: partRollIdsOf(p),
      targets,
    });
  };
  const row = (hpChangeId: string) =>
    t.s.db.select().from(hpChange).where(eq(hpChange.id, hpChangeId)).get() as HpChangeRecord;
  const comb = (cid: string) =>
    toCombatantRecord(
      t.s.db
        .select()
        .from(combatant)
        .where(eq(combatant.id, cid))
        .get() as typeof combatant.$inferSelect,
    );
  return { ...t, enc, id, hooks, attack, card, apply, row, comb };
}

/** A Divine-Fury-like stub: +6 radiant on each Hit target that was assigned `trg-fury`. */
function furyStub(seen: unknown[]): ApplyHook {
  return {
    id: "test.fury",
    beforeTarget(_env, a) {
      seen.push({
        input: a.input,
        targetAc: a.targetAc,
        weaponRaw: a.weaponRaw,
        hpChangeId: a.hpChangeId,
      });
      const mine = a.input.triggers?.find((x) => x.triggerId === "trg-fury");
      if (!mine) return { extraRaw: 0, parts: [], dm: {}, changes: [] };
      return {
        extraRaw: 6,
        parts: [{ label: "Divine Fury", value: 6, type: "radiant" }],
        dm: {
          parts: [{ triggerId: "trg-fury", label: "Divine Fury", rolled: 6 }],
          acMods: [{ effectId: "fx-sof", label: "Shield of Faith", value: 2 }],
        },
        triggerParts: [
          {
            triggerId: "trg-fury",
            name: "Divine Fury",
            value: 6,
            multiplier: "normal",
            type: "radiant",
            forced: false,
          },
        ],
        targetAc: a.targetAc + 2,
        changes: [{ type: COMBATANT_TYPE, id: a.target.id, before: a.target, after: a.target }],
      };
    },
    revert(_env, r) {
      seen.push({ revert: r.id, undone: r.undone });
      return [];
    },
  };
}

describe("FR-MOD-38 apply hooks (R0)", () => {
  test("FR-MOD-38 the registry (append-only lines); the server binds its own list; ids unique", () => {
    expect(new Set(applyHooks.map((h) => h.id)).size).toBe(applyHooks.length);
    const h = new ApplyHooks([]);
    h.register({ id: "x.one" });
    expect(() => h.register({ id: "x.one" })).toThrow(/registered twice/);
    const services = {};
    expect(() => applyHooksOf(services)).toThrow(/not bound/);
    bindApplyHooks(services, h);
    expect(applyHooksOf(services)).toBe(h);
  });

  test("FR-MOD-38 no hook → apply exactly as before: no parts, triggerParts []", () => {
    const t = started();
    const cardId = t.attack("Mira", 15, 4);
    const { hpChangeIds } = t.apply(cardId, [
      { targetId: t.id("Goblin"), hit: true, multiplier: "normal" },
    ]);
    const r = t.row(hpChangeIds[0] as string);
    expect(r).toMatchObject({ raw: 6, triggerParts: [] });
    const line = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r.entryId)).get();
    expect(AttackLogPayload.parse(line?.payload).parts).toBeUndefined();
    expect(AttackLogDmPayload.parse(line?.dmPayload).parts).toBeUndefined();
  });

  test("FR-MOD-38 a hook per target before hpRules.apply: raw = weapon + parts, line parts, DM facts, triggerParts, effective AC, rows in AttackApplied", () => {
    const t = started();
    const seen: unknown[] = [];
    t.hooks.register(furyStub(seen));
    try {
      const cardId = t.attack("Mira", 15, 4); // 19 to hit, 6 piercing
      const goblin = t.id("Goblin");
      const goblin2 = t.id("Goblin 2");
      const before = t.comb(goblin).hpCurrent as number;
      const n = t.events.length;
      const { hpChangeIds } = t.apply(cardId, [
        {
          targetId: goblin,
          hit: true,
          multiplier: "half",
          triggers: [{ triggerId: "trg-fury", value: 9 }],
        },
        { targetId: goblin2, hit: true, multiplier: "normal" },
      ]);
      // The hook saw the DM's input per target, the stored AC, the weapon raw after the row's
      // multiplier and the row id it will be written under.
      expect(seen).toEqual([
        {
          input: {
            targetId: goblin,
            hit: true,
            multiplier: "half",
            triggers: [{ triggerId: "trg-fury", value: 9 }],
          },
          targetAc: 15,
          weaponRaw: 3,
          hpChangeId: hpChangeIds[0],
        },
        {
          input: { targetId: goblin2, hit: true, multiplier: "normal" },
          targetAc: 15,
          weaponRaw: 6,
          hpChangeId: hpChangeIds[1],
        },
      ]);
      const r1 = t.row(hpChangeIds[0] as string);
      expect(r1).toMatchObject({ raw: 9, targetAc: 17, hitComputed: true });
      expect(r1.triggerParts).toEqual([
        {
          triggerId: "trg-fury",
          name: "Divine Fury",
          value: 6,
          multiplier: "normal",
          type: "radiant",
          forced: false,
        },
      ]);
      expect(t.comb(goblin).hpCurrent).toBe(Math.max(0, before - 9));
      expect(t.row(hpChangeIds[1] as string)).toMatchObject({
        raw: 6,
        targetAc: 15,
        triggerParts: [],
      });
      const line = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r1.entryId)).get();
      expect(AttackLogPayload.parse(line?.payload)).toMatchObject({
        damage: 9,
        parts: [{ label: "Divine Fury", value: 6, type: "radiant" }],
      });
      expect(AttackLogDmPayload.parse(line?.dmPayload)).toMatchObject({
        targetAc: 17,
        parts: [{ triggerId: "trg-fury", label: "Divine Fury", rolled: 6 }],
        acMods: [{ effectId: "fx-sof", label: "Shield of Faith", value: 2 }],
      });
      const applied = t.events.slice(n).filter((e) => e.event.type === "AttackApplied");
      expect(applied).toHaveLength(2);
      const hookRow = applied[0]?.event.changes.find(
        (c) =>
          c.type === COMBATANT_TYPE &&
          c.id === goblin &&
          (c.before as CombatantRecord).hpCurrent === (c.after as CombatantRecord).hpCurrent,
      );
      expect(hookRow).toBeDefined();
    } finally {
      t.hooks.unregister("test.fury");
    }
  });

  test("FR-MOD-38 a hook's conflict rolls the whole apply back: no HP, rows, line; card pending", () => {
    const t = started();
    t.hooks.register({
      id: "test.used",
      beforeTarget: () => {
        throw conflict("Divine Fury was already used this turn");
      },
    });
    try {
      const cardId = t.attack("Mira", 15, 4);
      const goblin = t.id("Goblin");
      const hp = t.comb(goblin).hpCurrent;
      const rows = t.count("hp_change");
      const e = t.err(() =>
        t.apply(cardId, [{ targetId: goblin, hit: true, multiplier: "normal" }]),
      );
      expect(e).toMatchObject({
        code: "conflict",
        message: "Divine Fury was already used this turn",
      });
      expect(t.comb(goblin).hpCurrent).toBe(hp);
      expect(t.count("hp_change")).toBe(rows);
      expect(t.card(cardId)?.state).toBe("pending");
    } finally {
      t.hooks.unregister("test.used");
    }
  });

  test("FR-MOD-38 extra damage on a miss is a hook bug: internal, nothing written", () => {
    const t = started();
    t.hooks.register({
      id: "test.bad",
      beforeTarget: () => ({ extraRaw: 4, parts: [], dm: {}, changes: [] }),
    });
    try {
      const cardId = t.attack("Mira", 15, 4);
      const rows = t.count("hp_change");
      expect(() =>
        t.apply(cardId, [{ targetId: t.id("Goblin"), hit: false, multiplier: "normal" }]),
      ).toThrow();
      expect(t.count("hp_change")).toBe(rows);
    } finally {
      t.hooks.unregister("test.bad");
    }
  });

  test("FR-MOD-38 intent: trigger parts only on Hit rows, each on one target → invalid", () => {
    const t = started();
    const cardId = t.attack("Mira", 15, 4);
    const code = (targets: Record<string, unknown>[]) => t.err(() => t.apply(cardId, targets)).code;
    expect(
      code([
        {
          targetId: t.id("Goblin"),
          hit: false,
          multiplier: "normal",
          triggers: [{ triggerId: "trg" }],
        },
      ]),
    ).toBe("invalid");
    expect(
      code([
        {
          targetId: t.id("Goblin"),
          hit: true,
          multiplier: "normal",
          triggers: [{ triggerId: "trg" }],
        },
        {
          targetId: t.id("Goblin 2"),
          hit: true,
          multiplier: "normal",
          triggers: [{ triggerId: "trg" }],
        },
      ]),
    ).toBe("invalid");
    expect(t.card(cardId)?.state).toBe("pending");
  });

  test("FR-MOD-41 undo runs revert per undone row in its transaction, before the card reopens", () => {
    const t = started();
    const seen: unknown[] = [];
    const stub = furyStub(seen);
    t.hooks.register({
      ...stub,
      revert(env, r) {
        stub.revert?.(env, r);
        // Inside the transaction: `r` is the row as it was before undo; the card is not reopened yet.
        const c = env.tx
          .select()
          .from(notification)
          .where(eq(notification.id, r.cardId as string))
          .get();
        seen.push({ cardState: c?.state });
        return [];
      },
    });
    try {
      const cardId = t.attack("Mira", 15, 4);
      const { hpChangeIds } = t.apply(cardId, [
        {
          targetId: t.id("Goblin"),
          hit: true,
          multiplier: "normal",
          triggers: [{ triggerId: "trg-fury" }],
        },
        { targetId: t.id("Goblin 2"), hit: true, multiplier: "normal" },
      ]);
      seen.length = 0;
      const n = t.events.length;
      t.run(undoCommand.name, { expectedHpChangeId: hpChangeIds[1] });
      expect(seen).toEqual([
        { revert: hpChangeIds[1], undone: false },
        { cardState: "resolved" },
        { revert: hpChangeIds[0], undone: false },
        { cardState: "resolved" },
      ]);
      const after = t.events.slice(n).map((e) => e.event.type);
      expect(after.at(-1)).toBe("NotificationReopened");
      expect(t.card(cardId)?.state).toBe("pending");
    } finally {
      t.hooks.unregister("test.fury");
    }
  });
});
