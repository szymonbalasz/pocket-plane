// Tier 2 / T roll seam with stub hooks (FR-MOD-17, -18, -19): `modes()` before the d20, the final
// mode and physical d20 counts, `manualParts` groups (`e:` strict, `t:` lenient), per-die `dice`,
// typed parts, `offered` on the payload (not in `total`), trigger names and notes in `dmPayload`.
import { describe, expect, test } from "bun:test";
import type {
  ManualPart,
  RollEntryDmPayload,
  RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { gameLogEntry, roll } from "../../db/schema";
import type { Services } from "../../services";
import { EFFECTS_CHANGED, type EvaluatedRoll, type EvaluateInput } from "./evaluate";
import { dice, gameLog } from "./index";
import type { OfferedPart, RollHook, RollModeHint, RollSubject } from "./roll-hooks";
import { diceServices, seedDice } from "./testing";

const MIRA = { characterId: "mira" };
const CHECK: RollSubject = { creature: MIRA, roll: "check", ability: "str" };
const DAMAGE: RollSubject = { creature: MIRA, roll: "damage", via: "weapon", card: true };

const hint = (mode: RollModeHint["mode"], label: string, pub = true): RollModeHint => ({
  effectId: `fx-${label.toLowerCase()}`,
  mode,
  label,
  public: pub,
});

/** Mode hints only (`modes()`), counting calls. */
function modeHook(hints: RollModeHint[], calls: { n: number } = { n: 0 }): RollHook {
  return {
    id: "test.modes",
    modes: () => {
      calls.n++;
      return hints;
    },
    adjust: () => ({ parts: [], modes: [] }),
  };
}

/** Bless +1d4 keyed `e:fx-bless`, `auto` iff the base is physical and its row is not. */
const blessHook: RollHook = {
  id: "test.bless",
  adjust(_env, _subject, base) {
    const r = base.rollExtra("1d4", "Bless", "e:fx-bless");
    return {
      parts: [
        {
          effectId: "fx-bless",
          label: "Bless",
          public: true,
          value: r.total,
          expression: "1d4",
          rollId: r.id,
          ...(base.manual && !r.manual ? { auto: true } : {}),
        },
      ],
      modes: [],
    };
  },
};

/** An offered "Divine Fury" 1d6+2 radiant keyed `t:trg-df`, plus a typed `roll` trigger part. */
function furyHook(o: { public?: boolean; expression?: string; notes?: string[] } = {}): RollHook {
  return {
    id: "test.fury",
    adjust(_env, _subject, base) {
      const expression = o.expression ?? "1d6+2";
      const r = base.rollExtra(expression, "Divine Fury", "t:trg-df");
      const offer: OfferedPart = {
        triggerId: "trg-df",
        label: "Divine Fury",
        public: o.public ?? true,
        value: r.total,
        expression,
        rollId: r.id,
        type: "radiant",
        ...(base.manual && !r.manual ? { auto: true } : {}),
        ask: "never on the roll item",
      };
      return {
        parts: [
          {
            effectId: "trg-blast",
            triggerId: "trg-blast",
            label: "Agonizing Blast",
            public: false,
            value: 3,
            type: "force",
          },
        ],
        modes: [],
        offered: [offer],
        ...(o.notes ? { notes: o.notes } : {}),
      };
    },
  };
}

function setup(seed?: string) {
  const { s } = diceServices(seed);
  const t = seedDice(s);
  let commands = 0;
  const rollWith = (hooks: readonly RollHook[], o: Partial<EvaluateInput> = {}) => {
    const cmd = defineCommand({
      name: `test.tier2.${++commands}`,
      input: z.object({}),
      roles: ["dm", "player"],
      execute(_i, env) {
        const r = dice.evaluate(
          env,
          {
            expression: "1d20+4",
            mode: "normal",
            category: "ability-check",
            label: "Athletics",
            actor: { kind: "entity", id: t.miraId, name: "Mira" },
            source: "char",
            subject: CHECK,
            ...o,
          },
          hooks,
        );
        gameLog.append(env, {
          kind: "roll",
          category: r.category,
          actorName: "Mira",
          payload: [dice.rollPayloadItem(r)],
          dmPayload: dice.rollDmPayload([r]),
          rollIds: dice.rollIdsOf(r),
          public: true,
        });
        return r;
      },
    });
    s.commands.register(cmd);
    return s.commands.run(cmd, {}, { actor: t.dm }) as EvaluatedRoll;
  };
  const err = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  return { s, t, rollWith, err };
}

const rolls = (s: Services) => s.db.select().from(roll).all();
const lastEntry = (s: Services) =>
  s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all().at(-1);
const itemOf = (s: Services) => (lastEntry(s)?.payload as RollEntryPayload | undefined)?.[0];
const dmOf = (s: Services) => lastEntry(s)?.dmPayload as RollEntryDmPayload | null;

describe("FR-MOD-17 mode before the d20", () => {
  test("FR-MOD-17 an advantage hint rolls two d20s; the row and line say adv with the hint's label", () => {
    const { s, rollWith } = setup();
    const r = rollWith([modeHook([hint("advantage", "Rage")])]);
    expect(r.mode).toBe("advantage");
    expect(r.expression).toBe("2d20kh1+4");
    expect(r.dice.filter((d) => d.faces === 20)).toHaveLength(2);
    expect(r.natural).not.toBeNull();
    const item = itemOf(s);
    expect(item?.mode).toBe("advantage");
    expect(item?.modes).toEqual(["Rage"]);
    expect(item?.mods).toBeUndefined();
    expect(dmOf(s)?.items[0]?.modes).toEqual([{ effectId: "fx-rage", label: "Rage" }]);
  });

  test("FR-MOD-17 adv + dis → normal (no hints listed); roller adv + hint dis → normal; secret hint label null", () => {
    const a = setup();
    const r = a.rollWith([modeHook([hint("advantage", "Rage"), hint("disadvantage", "Hex")])]);
    expect([r.mode, r.expression, r.mods?.modes]).toEqual(["normal", "1d20+4", []]);
    expect(itemOf(a.s)?.modes).toBeUndefined();
    const b = setup();
    expect(b.rollWith([modeHook([hint("disadvantage", "Hex")])], { mode: "advantage" }).mode).toBe(
      "normal",
    );
    const c = setup();
    const d = c.rollWith([modeHook([hint("disadvantage", "Bane", false)])]);
    expect(d.mode).toBe("disadvantage");
    expect(itemOf(c.s)?.modes).toEqual([null]);
    expect(dmOf(c.s)?.items[0]?.modes).toEqual([{ effectId: "fx-bane", label: "Bane" }]);
  });

  test("FR-MOD-17 no d20 (damage) → modes() not asked, mode stays normal; no subject → no hooks", () => {
    const calls = { n: 0 };
    const { rollWith } = setup();
    const r = rollWith([modeHook([hint("advantage", "Rage")], calls)], {
      expression: "1d12+4",
      category: "damage",
      subject: DAMAGE,
    });
    expect([calls.n, r.mode, r.expression]).toEqual([0, "normal", "1d12+4"]);
    rollWith([modeHook([hint("advantage", "Rage")], calls)], { subject: undefined });
    expect(calls.n).toBe(0);
  });

  test("FR-MOD-17 physical: one d20 when the final mode needs two → conflict, nothing written; two fit", () => {
    const { s, rollWith, err } = setup();
    const hooks = [modeHook([hint("advantage", "Rage")])];
    const before = rolls(s).length;
    const e = err(() => rollWith(hooks, { manual: { diceTotal: 15, dice: [15] } }));
    expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    expect(rolls(s)).toHaveLength(before);
    // The reverse: two d20s sent but the effect ended (no hint) → conflict too.
    expect(err(() => rollWith([], { manual: { diceTotal: 15, dice: [15, 3] } })).code).toBe(
      "conflict",
    );
    const r = rollWith(hooks, { manual: { diceTotal: 15, dice: [15, 3] } });
    expect([r.mode, r.manual, r.natural]).toEqual(["advantage", true, 15]);
    // A count no mode fits stays `invalid` (FR-DICE-06); a total alone can't be checked.
    expect(err(() => rollWith(hooks, { manual: { diceTotal: 15, dice: [15, 3, 2] } })).code).toBe(
      "invalid",
    );
    expect(rollWith(hooks, { manual: { diceTotal: 15 } }).mode).toBe("advantage");
  });
});

describe("FR-MOD-18 manualParts", () => {
  const blessGroup = (dice: number[]): ManualPart => ({
    key: "e:fx-bless",
    entry: { diceTotal: dice.reduce((a, b) => a + b, 0), dice },
  });
  const manual = { diceTotal: 12, dice: [12] };

  test("FR-MOD-18 e: group matches → the bonus die is that entry (physical, not auto); dice on the part", () => {
    const { s, rollWith } = setup();
    const r = rollWith([blessHook], { manual, manualParts: [blessGroup([3])] });
    const [p] = r.mods?.parts ?? [];
    expect(p).toMatchObject({ value: 3, dice: [3] });
    expect(p?.auto).toBeUndefined();
    expect(rolls(s).find((x) => x.id === p?.rollId)?.manual).toBe(true);
    expect(itemOf(s)?.mods).toEqual([
      { label: "Bless", value: 3, expression: "1d4", rollId: p?.rollId as string, dice: [3] },
    ]);
    expect(itemOf(s)?.total).toBe(12 + 4 + 3);
  });

  test("FR-MOD-18 e: mismatch → conflict 'Effects changed — roll again': missing group, surplus group, wrong dice count", () => {
    const { s, rollWith, err } = setup();
    const before = rolls(s).length;
    for (const manualParts of [
      [],
      [blessGroup([3]), { key: "e:fx-gone", entry: { diceTotal: 2 } }],
      [blessGroup([3, 1])],
    ]) {
      const e = err(() => rollWith([blessHook], { manual, manualParts }));
      expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    }
    // A surplus e: group with no hook asking for it at all.
    expect(err(() => rollWith([], { manual, manualParts: [blessGroup([3])] })).code).toBe(
      "conflict",
    );
    expect(rolls(s)).toHaveLength(before);
  });

  test("FR-MOD-18 tier 1 client (no manualParts) → server-rolled, auto; digital base never strict", () => {
    const a = setup();
    const [p] = a.rollWith([blessHook], { manual }).mods?.parts ?? [];
    expect(p?.auto).toBe(true);
    expect(itemOf(a.s)?.mods?.[0]?.auto).toBe(true);
    const b = setup();
    const [q] = b.rollWith([blessHook], { manualParts: [] }).mods?.parts ?? [];
    expect(q?.auto).toBeUndefined();
    expect(rolls(b.s).find((x) => x.id === q?.rollId)?.manual).toBe(false);
  });

  test("FR-MOD-18 t: never conflicts: group used when it fits; surplus ignored; missing or unfit → server-rolled, auto", () => {
    const sub = { expression: "1d12+4", category: "damage" as const, subject: DAMAGE };
    const dmg = { diceTotal: 8, dice: [8] };
    const used = setup();
    const r = used.rollWith([furyHook()], {
      ...sub,
      manual: dmg,
      manualParts: [{ key: "t:trg-df", entry: { diceTotal: 4, dice: [4] } }],
    });
    expect(r.mods?.offered?.[0]).toMatchObject({ value: 6, dice: [4] });
    expect(r.mods?.offered?.[0]?.auto).toBeUndefined();
    // Surplus: nothing offered (the charge is used) → the group is ignored, the roll commits.
    const surplus = setup();
    const s2 = surplus.rollWith([], {
      ...sub,
      manual: dmg,
      manualParts: [{ key: "t:trg-df", entry: { diceTotal: 4 } }],
    });
    expect(s2.total).toBe(12);
    for (const manualParts of [[], [{ key: "t:trg-df", entry: { diceTotal: 9, dice: [4, 5] } }]]) {
      const x = setup();
      const o = x.rollWith([furyHook()], { ...sub, manual: dmg, manualParts }).mods?.offered?.[0];
      expect(o?.auto).toBe(true);
      expect(rolls(x.s).find((y) => y.id === o?.rollId)?.manual).toBe(false);
    }
  });
});

describe("FR-MOD-19 payload: offered, per-die dice, typed parts, trigger names, notes", () => {
  test("FR-MOD-19 offered parts on the damage item, not in total; no settle facts; label iff public; rollIds", () => {
    const { s, rollWith } = setup();
    const r = rollWith([furyHook({ public: false })], {
      expression: "1d12+4",
      category: "damage",
      subject: DAMAGE,
    });
    const offer = r.mods?.offered?.[0];
    const item = itemOf(s);
    expect(item?.total).toBe(r.total + 3);
    expect(item?.offered).toEqual([
      {
        label: null,
        value: offer?.value as number,
        expression: "1d6+2",
        rollId: offer?.rollId as string,
        type: "radiant",
        dice: [(offer?.value as number) - 2],
      },
    ]);
    expect(item?.mods).toEqual([{ label: null, value: 3, type: "force" }]);
    expect(lastEntry(s)?.rollIds).toEqual([r.id, offer?.rollId as string]);
    expect(dmOf(s)).toEqual({
      items: [
        {
          mods: [{ triggerId: "trg-blast", label: "Agonizing Blast" }],
          offered: [{ triggerId: "trg-df", label: "Divine Fury" }],
        },
      ],
    });
  });

  test("FR-MOD-19 > 20 dice → no per-die values; DM notes ≤ 4, each ≤ 80 chars, alone make a dmPayload", () => {
    const { s, rollWith } = setup();
    const notes = ["a skipped", "b", "c", "d", "e", "x".repeat(100)];
    const r = rollWith([furyHook({ expression: "21d6", notes })], {
      expression: "1d12+4",
      category: "damage",
      subject: DAMAGE,
    });
    expect(r.mods?.offered?.[0]?.dice).toBeUndefined();
    expect(dmOf(s)?.notes).toEqual(["a skipped", "b", "c", "d"]);
    const quiet: RollHook = {
      id: "test.quiet",
      adjust: () => ({ parts: [], modes: [], notes: ["y".repeat(90)] }),
    };
    rollWith([quiet], { expression: "1d12+4", category: "damage", subject: DAMAGE });
    expect(dmOf(s)).toEqual({ items: [{ mods: [] }], notes: [`${"y".repeat(79)}…`] });
    expect(itemOf(s)?.offered).toBeUndefined();
  });
});
