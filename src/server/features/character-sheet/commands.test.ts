// character-sheet commands and `characters.adjustHp` on in-memory services (CHAR §13 integration).
import { describe, expect, test } from "bun:test";
import { type EntryLike, formatEntry } from "@shared/dice-roll-log/line";
import type { RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { entity, eventLog, gameLogEntry, roll } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import { setCategoryPublic } from "../dice-roll-log/settings";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { createEntity } from "../entities/commands";
import { miraBlock } from "../entities/testing";
import { charAdjustHp, charRoll } from "./commands";
import { characters } from "./index";

// Pip (CHAR §13): Mira's block without attack, speed or ability scores.
const { speed: _sp, abilities: _ab, saveProficiencies: _sv, ...pipBase } = miraBlock;

function setup(seed?: string) {
  const { s } = diceServices(seed);
  const seeded = seedDice(s);
  const pip = s.commands.run(
    createEntity,
    {
      kind: "character",
      name: "Pip",
      ownerPlayerId: seeded.p1.id,
      statBlock: { ...pipBase, attacks: [], className: "Wizard", hpMax: 8 },
    },
    { actor: seeded.dm },
  );
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  return { s, events, pipId: pip.id, ...seeded };
}

const fail = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
};

const entries = (s: Services) =>
  s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all();
const rolls = (s: Services) => s.db.select().from(roll).all();
const logRows = (s: Services, type: string) =>
  s.db.select().from(eventLog).where(eq(eventLog.type, type)).all();
const hpOf = (s: Services, id: string) =>
  s.db.select({ hp: entity.hpCurrent }).from(entity).where(eq(entity.id, id)).get()?.hp;

describe("FR-CHAR-05 FR-CHAR-08 char.roll", () => {
  test("FR-CHAR-05 FR-CHAR-08 initiative: one roll d20+initBonus, one entry, CharacterRolled", () => {
    const t = setup();
    const res = t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "initiative" },
      { actor: t.p1Actor },
    );
    const [r] = rolls(t.s);
    const [e] = entries(t.s);
    expect(res).toEqual({ rollIds: [r?.id as string], entryId: e?.id as string });
    expect(r).toMatchObject({
      expression: "1d20+2",
      category: "initiative",
      label: "Initiative",
      source: "char",
      actorKind: "entity",
      actorId: t.miraId,
      actorName: "Mira",
      mode: "normal",
      manual: false,
    });
    expect(e).toMatchObject({ kind: "roll", category: "initiative", actorName: "Mira" });
    expect(e?.payload as RollEntryPayload).toHaveLength(1);
    expect(t.events.map((x) => x.event.type)).toEqual(["CharacterRolled"]);
    expect(t.events[0]?.event.payload).toEqual({
      characterId: t.miraId,
      kind: "initiative",
      mode: "normal",
      manual: false,
      rollIds: [r?.id],
      entryId: e?.id,
    });
    expect(t.events[0]?.event.changes.map((c) => c.type)).toEqual(["game-log-entry"]);
    expect(logRows(t.s, "CharacterRolled")).toHaveLength(1);
  });

  test("FR-CHAR-05 FR-CHAR-06 FR-CHAR-08 attack: to-hit + damage, one entry; mode on the d20 only", () => {
    const t = setup();
    const res = t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "attack", mode: "advantage" },
      { actor: t.p1Actor },
    );
    const rs = rolls(t.s);
    expect(rs.map((r) => [r.category, r.label, r.expression, r.mode])).toEqual([
      ["attack", "Shortsword attack", "2d20kh1+4", "advantage"],
      ["damage", "Shortsword damage (piercing)", "1d6+2", "normal"],
    ]);
    const toHit = rs[0]?.dice as { value: number; kept: boolean }[];
    expect(toHit).toHaveLength(2);
    expect(rs[0]?.total).toBe(Math.max(...toHit.map((d) => d.value)) + 4);
    const dmg = rs[1]?.total as number;
    expect(dmg).toBeGreaterThanOrEqual(3);
    expect(dmg).toBeLessThanOrEqual(8);
    const [e] = entries(t.s);
    expect(entries(t.s)).toHaveLength(1);
    expect(e).toMatchObject({ category: "attack", rollIds: rs.map((r) => r.id) });
    expect(e?.payload as RollEntryPayload).toHaveLength(2);
    expect(res.rollIds).toEqual(rs.map((r) => r.id));
    expect(t.events.map((x) => x.event.payload)).toEqual([
      {
        characterId: t.miraId,
        kind: "attack",
        mode: "advantage",
        manual: false,
        attackName: "Shortsword",
        damageType: "piercing",
        rollIds: rs.map((r) => r.id),
        entryId: e?.id,
      },
    ]);
  });

  test("FR-CHAR-07 manual: one entry per roll, logged as manual; count / range checked", () => {
    const t = setup();
    t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "initiative", manual: [{ diceTotal: 15 }] },
      { actor: t.p1Actor },
    );
    t.s.commands.run(
      charRoll,
      {
        characterId: t.miraId,
        kind: "attack",
        manual: [{ diceTotal: 12 }, { diceTotal: 5 }],
      },
      { actor: t.p1Actor },
    );
    expect(rolls(t.s).map((r) => [r.manual, r.total])).toEqual([
      [true, 17],
      [true, 16],
      [true, 7],
    ]);
    expect(t.events.map((e) => (e.event.payload as { manual: boolean }).manual)).toEqual([
      true,
      true,
    ]);
    const bad: unknown[] = [
      { characterId: t.miraId, kind: "attack", manual: [{ diceTotal: 12 }] },
      { characterId: t.miraId, kind: "initiative", manual: [{ diceTotal: 2 }, { diceTotal: 2 }] },
      { characterId: t.miraId, kind: "initiative", manual: [{ diceTotal: 21 }] },
    ];
    for (const input of bad) {
      expect(fail(() => t.s.commands.run("char.roll", input, { actor: t.p1Actor })).code).toBe(
        "invalid",
      );
    }
    expect(rolls(t.s)).toHaveLength(3);
  });

  test("FR-CHAR-08 a failing roll writes nothing: no roll, entry or event", () => {
    const t = setup();
    // To-hit is fine, damage manual total out of range (1d6 → 1–6): the first roll rolls back.
    const err = fail(() =>
      t.s.commands.run(
        charRoll,
        { characterId: t.miraId, kind: "attack", manual: [{ diceTotal: 10 }, { diceTotal: 9 }] },
        { actor: t.dm },
      ),
    );
    expect(err.code).toBe("invalid");
    expect(rolls(t.s)).toHaveLength(0);
    expect(entries(t.s)).toHaveLength(0);
    expect(t.events).toHaveLength(0);
    expect(logRows(t.s, "CharacterRolled")).toHaveLength(0);
  });

  test("FR-CHAR-05 FR-CHARX-20 strict schema: expression, toHit, wrong kind + ref → invalid", () => {
    const t = setup();
    for (const extra of [
      { kind: "initiative", expression: "1d20+30" },
      { kind: "attack", toHit: 25 },
      { kind: "damage", skill: "stealth" },
      { kind: "initiative", hp: 3 },
    ]) {
      const err = fail(() =>
        t.s.commands.run("char.roll", { characterId: t.miraId, ...extra }, { actor: t.p1Actor }),
      );
      expect({ extra, code: err.code }).toEqual({ extra, code: "invalid" });
    }
    expect(rolls(t.s)).toHaveLength(0);
  });
});

/** Replaces a character's scores (null = none): stat block edited between click and commit. */
function withScores(s: Services, id: string, extra: Record<string, unknown> | null) {
  const row = s.db.select().from(entity).where(eq(entity.id, id)).get();
  if (!row) throw new Error(`no entity ${id}`);
  const {
    abilities: _a,
    saveProficiencies: _s,
    ...rest
  } = row.statBlock as Record<string, unknown>;
  s.db
    .update(entity)
    .set({ statBlock: { ...rest, ...extra } })
    .where(eq(entity.id, id))
    .run();
}
const lineText = (e: { kind: string; actorName: string; payload: unknown } | undefined) =>
  formatEntry(e as EntryLike)
    .segments.map((x) => x.text)
    .join("");

describe("FR-CHAR-21 checks and saves", () => {
  test("FR-CHAR-21 save / check: category, label, derived bonus, one roll + entry + CharacterRolled {ability}", () => {
    const t = setup();
    const res = t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "save", ability: "dex", mode: "advantage" },
      { actor: t.p1Actor },
    );
    const [r] = rolls(t.s);
    const [e] = entries(t.s);
    expect(res).toEqual({ rollIds: [r?.id as string], entryId: e?.id as string });
    expect(r).toMatchObject({
      expression: "2d20kh1+2",
      category: "saving-throw",
      label: "Dexterity save",
      mode: "advantage",
      source: "char",
      actorName: "Mira",
    });
    expect(e).toMatchObject({ kind: "roll", category: "saving-throw", actorName: "Mira" });
    expect(t.events.map((x) => x.event.payload)).toEqual([
      {
        characterId: t.miraId,
        kind: "save",
        ability: "dex",
        mode: "advantage",
        manual: false,
        rollIds: [r?.id],
        entryId: e?.id,
      },
    ]);
    expect(logRows(t.s, "CharacterRolled")).toHaveLength(1);

    // Proficient save adds PB (+2 at level 1); check = modifier; 0 → plain d20; negative → 1d20-1.
    const exprOf = (characterId: string, kind: string, ability: string) => {
      t.s.commands.run("char.roll", { characterId, kind, ability }, { actor: t.dm });
      return rolls(t.s).at(-1)?.expression;
    };
    expect(exprOf(t.miraId, "save", "str")).toBe("1d20+4");
    expect(exprOf(t.miraId, "save", "con")).toBe("1d20+4");
    expect(exprOf(t.miraId, "check", "wis")).toBe("1d20+1");
    expect(exprOf(t.miraId, "check", "int")).toBe("1d20");
    expect(exprOf(t.thornId, "check", "str")).toBe("1d20-1");
    expect(exprOf(t.thornId, "save", "dex")).toBe("1d20+5");
    expect(entries(t.s).at(-2)).toMatchObject({ category: "ability-check" });
  });

  test("FR-CHAR-21 FR-CHAR-07 manual = 1 entry; line 'Mira — Wisdom save: 15 + 1 = 16', physical", () => {
    const t = setup();
    t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "save", ability: "wis", manual: [{ diceTotal: 15 }] },
      { actor: t.p1Actor },
    );
    expect(rolls(t.s).map((r) => [r.manual, r.total])).toEqual([[true, 16]]);
    expect(lineText(entries(t.s)[0])).toBe("Mira — Wisdom save: 15 + 1 = 16 physical");
    t.s.commands.run(
      charRoll,
      { characterId: t.miraId, kind: "check", ability: "str", manual: [{ diceTotal: 20 }] },
      { actor: t.p1Actor },
    );
    expect(lineText(entries(t.s)[1])).toBe(
      "Mira — Strength check: 20 + 2 = 22 — natural 20! physical",
    );
    expect(
      fail(() =>
        t.s.commands.run(
          "char.roll",
          {
            characterId: t.miraId,
            kind: "save",
            ability: "dex",
            manual: [{ diceTotal: 3 }, { diceTotal: 4 }],
          },
          { actor: t.p1Actor },
        ),
      ).code,
    ).toBe("invalid");
    expect(rolls(t.s)).toHaveLength(2);
  });

  test("FR-CHAR-17 FR-CHAR-21 DM save hidden with defaults, public after setCategoryPublic; player save public", () => {
    const t = setup();
    const save = (actor: Actor, characterId: string, extra: Record<string, unknown> = {}) =>
      t.s.commands.run(
        "char.roll",
        { characterId, kind: "save", ability: "dex", ...extra },
        { actor },
      );
    save(t.dm, t.thornId);
    save(t.p2Actor, t.thornId);
    save(t.dm, t.thornId, { public: true });
    t.s.commands.run(
      setCategoryPublic,
      { category: "saving-throw", public: true },
      { actor: t.dm },
    );
    save(t.dm, t.thornId);
    save(t.dm, t.thornId, { public: false });
    // The check category is separate ("Ability check" tickbox).
    t.s.commands.run(
      "char.roll",
      { characterId: t.thornId, kind: "check", ability: "dex" },
      { actor: t.dm },
    );
    expect(entries(t.s).map((e) => [e.category, e.public])).toEqual([
      ["saving-throw", false],
      ["saving-throw", true],
      ["saving-throw", true],
      ["saving-throw", true],
      ["saving-throw", false],
      ["ability-check", false],
    ]);
    expect(fail(() => save(t.p2Actor, t.thornId, { public: true })).code).toBe("forbidden");
  });

  test("FR-CHAR-09 FR-CHAR-21 no scores → conflict; ability missing / on attack / unknown → invalid; nothing written", () => {
    const t = setup();
    const run = (input: Record<string, unknown>, actor: Actor = t.p1Actor) =>
      t.s.commands.run("char.roll", input, { actor });
    const pip = fail(() => run({ characterId: t.pipId, kind: "check", ability: "dex" }));
    expect([pip.code, pip.message]).toEqual(["conflict", "No ability scores"]);
    expect(fail(() => run({ characterId: t.pipId, kind: "save", ability: "str" })).code).toBe(
      "conflict",
    );
    for (const bad of [
      { kind: "check" },
      { kind: "save" },
      { kind: "attack", ability: "str" },
      { kind: "initiative", ability: "dex" },
      { kind: "save", ability: "luck" },
      { kind: "check", ability: "dex", bonus: 5 },
      { kind: "save", ability: "dex", expression: "1d20+30" },
    ]) {
      const err = fail(() => run({ characterId: t.miraId, ...bad }));
      expect({ bad, code: err.code }).toEqual({ bad, code: "invalid" });
    }
    // Ownership as for any roll.
    expect(fail(() => run({ characterId: t.thornId, kind: "save", ability: "dex" })).code).toBe(
      "forbidden",
    );
    // Scores removed between click and commit → conflict (CHAR §11).
    withScores(t.s, t.miraId, null);
    expect(fail(() => run({ characterId: t.miraId, kind: "save", ability: "dex" })).code).toBe(
      "conflict",
    );
    expect(rolls(t.s)).toHaveLength(0);
    expect(entries(t.s)).toHaveLength(0);
    expect(t.events).toHaveLength(0);
  });
});

describe("FR-CHAR-09 authorize", () => {
  test("FR-CHAR-09 FR-CHARX-22 matrix: DM any PC or definition; owner; other player forbidden; player monster / unknown / other campaign not_found; no attack conflict", () => {
    const t = setup();
    const run = (actor: Actor, characterId: string, kind = "initiative") =>
      t.s.commands.run("char.roll", { characterId, kind }, { actor });
    run(t.dm, t.miraId);
    run(t.dm, t.thornId, "attack");
    run(t.p1Actor, t.miraId);
    run(t.p2Actor, t.thornId, "attack");
    run(t.p1Actor, t.pipId);
    expect(fail(() => run(t.p1Actor, t.thornId)).code).toBe("forbidden");
    expect(fail(() => run(t.p2Actor, t.miraId)).code).toBe("forbidden");
    for (const id of ["nope", t.strangerId]) {
      expect(fail(() => run(t.dm, id)).code).toBe("not_found");
    }
    for (const id of [t.goblinId, "nope", t.strangerId]) {
      expect(fail(() => run(t.p1Actor, id)).code).toBe("not_found");
    }
    const noAttack = fail(() => run(t.p1Actor, t.pipId, "attack"));
    expect([noAttack.code, noAttack.message]).toEqual(["conflict", "No weapon attack"]);
    // FR-CHARX-22: the DM rolls for an imported definition (NPC sheet), DM-only.
    run(t.dm, t.goblinId);
    expect(entries(t.s)).toHaveLength(6);
    expect(entries(t.s).at(-1)).toMatchObject({ actorName: "Goblin", public: false });
    expect(t.events).toHaveLength(6);

    // Same rule for char.adjustHp.
    const hp = (actor: Actor, characterId: string) =>
      t.s.commands.run("char.adjustHp", { characterId, delta: -1 }, { actor });
    expect(fail(() => hp(t.p1Actor, t.thornId)).code).toBe("forbidden");
    expect(fail(() => hp(t.p2Actor, t.miraId)).code).toBe("forbidden");
    for (const id of [t.goblinId, "nope", t.strangerId]) {
      expect(fail(() => hp(t.dm, id)).code).toBe("not_found");
    }
    expect(hpOf(t.s, t.thornId)).toBe(10);
    expect(hpOf(t.s, t.miraId)).toBe(12);
    expect(t.events).toHaveLength(6);
  });
});

describe("FR-CHAR-17 public stamping", () => {
  test("FR-CHAR-17 player → public; DM → category setting or override; player `public` → forbidden", () => {
    const t = setup();
    const run = (actor: Actor, extra: Record<string, unknown> = {}) =>
      t.s.commands.run(
        "char.roll",
        { characterId: t.miraId, kind: "initiative", ...extra },
        { actor },
      );
    run(t.p1Actor);
    run(t.dm);
    run(t.dm, { public: true });
    t.s.commands.run(setCategoryPublic, { category: "initiative", public: true }, { actor: t.dm });
    run(t.dm);
    run(t.dm, { public: false });
    expect(entries(t.s).map((e) => e.public)).toEqual([true, false, true, true, false]);
    expect(fail(() => run(t.p1Actor, { public: true })).code).toBe("forbidden");
    expect(fail(() => run(t.p1Actor, { public: false })).code).toBe("forbidden");
    // Attack: the entry's category is `attack` (FR-DICE-26).
    t.s.commands.run(setCategoryPublic, { category: "attack", public: true }, { actor: t.dm });
    t.s.commands.run(charRoll, { characterId: t.thornId, kind: "attack" }, { actor: t.dm });
    expect(entries(t.s).at(-1)).toMatchObject({ category: "attack", public: true });
    expect(entries(t.s)).toHaveLength(6);
  });
});

describe("FR-CHAR-10 char.adjustHp", () => {
  test("FR-CHAR-10 clamps; event + event-log row; result {hpBefore, hpAfter}", () => {
    const t = setup();
    const adj = (delta: number, actor: Actor = t.p1Actor) =>
      t.s.commands.run(charAdjustHp, { characterId: t.miraId, delta }, { actor });
    expect(adj(-5)).toEqual({ hpBefore: 12, hpAfter: 7 });
    expect(adj(20)).toEqual({ hpBefore: 7, hpAfter: 12 });
    expect(adj(-15, t.dm)).toEqual({ hpBefore: 12, hpAfter: 0 });
    expect(hpOf(t.s, t.miraId)).toBe(0);
    expect(t.events.map((e) => e.event.payload)).toEqual([
      { entityId: t.miraId, delta: -5, hpBefore: 12, hpAfter: 7 },
      { entityId: t.miraId, delta: 20, hpBefore: 7, hpAfter: 12 },
      { entityId: t.miraId, delta: -15, hpBefore: 12, hpAfter: 0 },
    ]);
    expect(t.events[0]?.event.changes).toEqual([
      {
        type: ENTITY_TYPE,
        id: t.miraId,
        before: expect.objectContaining({ hpCurrent: 12 }),
        after: expect.objectContaining({ hpCurrent: 7 }),
      },
    ]);
    expect(logRows(t.s, "CharacterHpAdjusted")).toHaveLength(3);
  });

  test("FR-CHAR-10 no-op clamp → success, no event, no log row", () => {
    const t = setup();
    const adj = (delta: number) =>
      t.s.commands.run(charAdjustHp, { characterId: t.miraId, delta }, { actor: t.dm });
    expect(adj(5)).toEqual({ hpBefore: 12, hpAfter: 12 });
    expect(t.events).toHaveLength(0);
    expect(logRows(t.s, "CharacterHpAdjusted")).toHaveLength(0);
    for (const delta of [0, 1000, -1000, 2.5]) {
      expect(
        fail(() =>
          t.s.commands.run("char.adjustHp", { characterId: t.miraId, delta }, { actor: t.dm }),
        ).code,
      ).toBe("invalid");
    }
  });

  test("FR-CHAR-14 after adjust: DM + owner see HP; another player's entity record has none", () => {
    const t = setup();
    t.s.commands.run(charAdjustHp, { characterId: t.miraId, delta: -3 }, { actor: t.dm });
    const find = (v: ReturnType<typeof t.viewer>) =>
      (t.snapshot(v)[ENTITY_TYPE] as { id: string }[]).find((e) => e.id === t.miraId);
    expect(find(t.viewer("dm"))).toMatchObject({ hpCurrent: 9 });
    expect(find(t.viewer("player", t.p1.id))).toMatchObject({ hpCurrent: 9 });
    const other = find(t.viewer("player", t.p2.id));
    expect(other).toBeDefined();
    expect(other).not.toHaveProperty("hpCurrent");
    expect(other).not.toHaveProperty("statBlock");
  });
});

describe("FR-CHAR-13 characters.adjustHp", () => {
  const helper = (opts: { fail?: boolean }) =>
    defineCommand({
      name: "test.adjust",
      input: z.object({ id: z.string(), delta: z.number() }),
      execute({ id, delta }, env) {
        const r = characters.adjustHp(env, id, delta);
        if (r.change) {
          env.emit({
            type: "CharacterHpAdjusted",
            campaignId: env.actor.campaignId,
            payload: { entityId: id, delta, hpBefore: r.hpBefore, hpAfter: r.hpAfter },
            changes: [r.change],
          });
        }
        if (opts.fail) throw new CommandError("conflict", "caller failed");
        return { hpBefore: r.hpBefore, hpAfter: r.hpAfter, changed: r.change !== null };
      },
    });

  test("FR-CHAR-13 clamps in the caller's tx, returns the entity change, emits nothing itself", () => {
    const t = setup();
    t.s.commands.register(helper({}));
    expect(t.s.commands.run("test.adjust", { id: t.thornId, delta: -4 }, { actor: t.dm })).toEqual({
      hpBefore: 10,
      hpAfter: 6,
      changed: true,
    });
    // Combat's undo: inverse delta, clamped (I2).
    expect(t.s.commands.run("test.adjust", { id: t.thornId, delta: 40 }, { actor: t.dm })).toEqual({
      hpBefore: 6,
      hpAfter: 10,
      changed: true,
    });
    expect(t.s.commands.run("test.adjust", { id: t.thornId, delta: 1 }, { actor: t.dm })).toEqual({
      hpBefore: 10,
      hpAfter: 10,
      changed: false,
    });
    expect(t.events).toHaveLength(2);
    expect(
      fail(() => t.s.commands.run("test.adjust", { id: t.goblinId, delta: -1 }, { actor: t.dm }))
        .code,
    ).toBe("not_found");
  });

  test("FR-CHAR-13 rolls back with its caller's transaction", () => {
    const t = setup();
    t.s.commands.register(helper({ fail: true }));
    expect(
      fail(() => t.s.commands.run("test.adjust", { id: t.miraId, delta: -5 }, { actor: t.dm }))
        .code,
    ).toBe("conflict");
    expect(hpOf(t.s, t.miraId)).toBe(12);
    expect(t.events).toHaveLength(0);
    expect(logRows(t.s, "CharacterHpAdjusted")).toHaveLength(0);
  });
});
