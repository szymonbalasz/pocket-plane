// FR-MOD-13/14/18/19 roll seam with stub hooks: `dice.evaluate` runs the hooks only for a
// subject, after the base row, in the caller's transaction; bonus dice are their own rows;
// payload `mods` / total / `dmPayload` / `rollIds`; a throwing hook rolls the command back.
import { describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE, type RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { DiceRolled } from "@shared/events/dice-roll-log";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { eventLog, gameLogEntry, roll } from "../../db/schema";
import type { Services } from "../../services";
import type { EvaluatedRoll, EvaluateInput } from "./evaluate";
import { dice, gameLog } from "./index";
import { type RollHook, type RollHookBase, type RollSubject, rollHooks } from "./roll-hooks";
import { diceServices, seedDice } from "./testing";

const MIRA = { characterId: "mira" };
const ATTACK: RollSubject = { creature: MIRA, roll: "attack", via: "weapon" };

type Seen = { subject: RollSubject; base: Omit<RollHookBase, "rollExtra"> }[];

/** Bless: +1d4 through `rollExtra`, public. Records what it saw. */
function blessHook(seen: Seen) {
  return {
    id: "test.bless",
    adjust(_env, subject, base) {
      seen.push({
        subject,
        base: { manual: base.manual, category: base.category, source: base.source },
      });
      const r = base.rollExtra("1d4", "Bless");
      return {
        parts: [
          {
            effectId: "fx-bless",
            label: "Bless",
            public: true,
            value: r.total,
            expression: r.expression,
            rollId: r.id,
            ...(base.manual ? { auto: true } : {}),
          },
        ],
        modes: [],
      };
    },
  } satisfies RollHook;
}

/** A secret flat −2 ("Cursed") and a hidden advantage hint. */
const cursedHook: RollHook = {
  id: "test.cursed",
  adjust: () => ({
    parts: [{ effectId: "fx-cursed", label: "Cursed", public: false, value: -2 }],
    modes: [{ effectId: "fx-cursed", mode: "advantage", label: "Cursed", public: false }],
  }),
};

function setup(seed?: string) {
  const { s } = diceServices(seed);
  const t = seedDice(s);
  let commands = 0;
  /** One `roll` entry of one evaluate call, in a command (as a real caller would). */
  const rollWith = (
    hooks: readonly RollHook[],
    o: Partial<EvaluateInput> = {},
    after?: (r: EvaluatedRoll) => void,
  ) => {
    const cmd = defineCommand({
      name: `test.hooked.${++commands}`,
      input: z.object({}),
      roles: ["dm", "player"],
      execute(_i, env) {
        const r = dice.evaluate(
          env,
          {
            expression: "1d20+4",
            mode: "normal",
            category: "attack",
            label: "Shortsword attack",
            actor: { kind: "entity", id: t.miraId, name: "Mira" },
            source: "char",
            subject: ATTACK,
            ...o,
          },
          hooks,
        );
        const change = gameLog.append(env, {
          kind: "roll",
          category: "attack",
          actorName: "Mira",
          payload: [dice.rollPayloadItem(r)],
          dmPayload: dice.rollDmPayload([r]),
          rollIds: dice.rollIdsOf(r),
          public: true,
        });
        env.emit({
          type: DiceRolled.type,
          campaignId: env.actor.campaignId,
          payload: { entryId: change.id, rollIds: dice.rollIdsOf(r) },
          changes: [change],
        });
        after?.(r);
        return r;
      },
    });
    s.commands.register(cmd);
    return s.commands.run(cmd, {}, { actor: t.dm }) as EvaluatedRoll;
  };
  return { s, t, rollWith };
}

const rolls = (s: Services) => s.db.select().from(roll).all();
const entries = (s: Services) =>
  s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all();
const count = (s: Services, table: string) =>
  s.db.$client.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;

describe("FR-MOD-13 roll hooks registry", () => {
  test("FR-MOD-13 registry: unique ids, each with adjust", () => {
    const ids = rollHooks.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of rollHooks) expect(typeof h.adjust).toBe("function");
  });
});

describe("FR-MOD-13 dice.evaluate with a subject", () => {
  test("FR-MOD-13 no subject → hooks never run, no mods; rolls identical to a hookless run", () => {
    const seen: Seen = [];
    const a = setup("same-seed");
    const r = a.rollWith([blessHook(seen)], { subject: undefined });
    expect(seen).toHaveLength(0);
    expect("mods" in r).toBe(false);
    const b = setup("same-seed");
    b.rollWith([], { subject: undefined });
    const strip = (s: Services) => rolls(s).map(({ id: _id, ...x }) => x);
    expect(strip(a.s)).toEqual(strip(b.s));
    expect(rolls(a.s)).toHaveLength(1);
    expect(entries(a.s)[0]?.dmPayload).toBeNull();
  });

  test("FR-MOD-14 subject → hooks in order after the base row; bonus die its own row; total, mods, rollIds", () => {
    const seen: Seen = [];
    const { s, rollWith } = setup();
    const r = rollWith([blessHook(seen), cursedHook]);
    expect(seen).toEqual([
      { subject: ATTACK, base: { manual: false, category: "attack", source: "char" } },
    ]);
    const [base, bonus] = rolls(s);
    expect(base?.id).toBe(r.id);
    expect(bonus).toMatchObject({
      expression: "1d4",
      label: "Bless",
      category: "attack",
      source: "char",
      actorKind: "entity",
      actorName: "Mira",
      mode: "normal",
      manual: false,
    });
    const blessValue = bonus?.total as number;
    expect(blessValue).toBeGreaterThanOrEqual(1);
    expect(blessValue).toBeLessThanOrEqual(4);
    expect(r.mods?.modTotal).toBe(blessValue - 2);
    expect(r.total).toBe(base?.total as number);
    const [e] = entries(s);
    const [item] = (e?.payload ?? []) as RollEntryPayload;
    expect(item?.total).toBe((base?.total as number) + blessValue - 2);
    expect(item?.mods).toEqual([
      { label: "Bless", value: blessValue, expression: "1d4", rollId: bonus?.id as string },
      { label: null, value: -2 },
    ]);
    expect(item?.modes).toEqual([null]);
    expect(item?.natural).toBe(base?.natural ?? null);
    expect(e?.dmPayload).toEqual({
      items: [
        {
          mods: [
            { effectId: "fx-bless", label: "Bless" },
            { effectId: "fx-cursed", label: "Cursed" },
          ],
          modes: [{ effectId: "fx-cursed", label: "Cursed" }],
        },
      ],
    });
    expect(e?.rollIds).toEqual([r.id, bonus?.id]);
  });

  test("FR-MOD-16 / -37 an offered trigger part is rolled as its own row, never in the total or mods", () => {
    const furyHook: RollHook = {
      id: "test.fury",
      modes: () => [],
      adjust(_env, subject, base) {
        expect(subject).toMatchObject({ card: true, row: "Greataxe", toHitMode: "advantage" });
        const r = base.rollExtra("1d6+2", "Divine Fury");
        return {
          parts: [],
          modes: [],
          offered: [
            {
              triggerId: "trg-fury",
              label: "Divine Fury",
              public: true,
              value: r.total,
              expression: r.expression,
              rollId: r.id,
              type: "radiant",
              dice: [r.total - 2],
            },
          ],
          notes: ["Sneak Attack skipped: 30 dice > 25"],
        };
      },
    };
    const { s, rollWith } = setup();
    const r = rollWith([furyHook], {
      expression: "1d12+4",
      category: "damage",
      subject: {
        creature: MIRA,
        roll: "damage",
        via: "weapon",
        card: true,
        row: "Greataxe",
        toHitMode: "advantage",
      },
    });
    const [base, offer] = rolls(s);
    expect(offer).toMatchObject({ label: "Divine Fury", expression: "1d6+2" });
    const [item] = (entries(s)[0]?.payload ?? []) as RollEntryPayload;
    expect(item?.total).toBe(base?.total as number);
    expect(item?.mods).toBeUndefined();
    expect(r.mods?.modTotal).toBe(0);
  });

  test("FR-MOD-19 / FR-MOD-23 players get the entry without dmPayload: no secret label, no effect ids", () => {
    const { s, t, rollWith } = setup();
    rollWith([blessHook([]), cursedHook]);
    const p = t.snapshot(t.viewer("player", t.p1.id))[GAME_LOG_ENTRY_TYPE] as Record<
      string,
      unknown
    >[];
    expect(p).toHaveLength(1);
    expect(Object.keys(p[0] ?? {})).not.toContain("dmPayload");
    const json = JSON.stringify(p);
    for (const leak of ["Cursed", "fx-cursed", "fx-bless"]) expect(json).not.toContain(leak);
    expect(json).toContain("Bless");
    const dm = JSON.stringify(t.snapshot(t.viewer("dm"))[GAME_LOG_ENTRY_TYPE]);
    expect(dm).toContain("Cursed");
    expect(entries(s)).toHaveLength(1);
  });

  test("FR-MOD-18 physical base: hooks see manual; server-rolled bonus die tagged auto", () => {
    const seen: Seen = [];
    const { s, rollWith } = setup();
    const r = rollWith([blessHook(seen)], { manual: { diceTotal: 10 } });
    expect(seen[0]?.base?.manual).toBe(true);
    expect(r.manual).toBe(true);
    expect(rolls(s)[1]?.manual).toBe(false);
    const [item] = (entries(s)[0]?.payload ?? []) as RollEntryPayload;
    expect(item?.mods?.[0]?.auto).toBe(true);
    expect(item?.total).toBe(14 + (r.mods?.modTotal ?? 0));
  });

  test("FR-MOD-13 a throwing hook rolls the whole command back: no rolls, entry or event", () => {
    const { s, rollWith } = setup();
    const before = ["roll", "game_log_entry", "event_log"].map((x) => count(s, x));
    const boom: RollHook = {
      id: "test.boom",
      adjust: () => {
        throw new Error("hook failed");
      },
    };
    expect(() => rollWith([blessHook([]), boom])).toThrow();
    expect(["roll", "game_log_entry", "event_log"].map((x) => count(s, x))).toEqual(before);
    expect(
      s.db
        .select()
        .from(eventLog)
        .all()
        .map((l) => l.type),
    ).not.toContain("DiceRolled");
  });

  test("FR-MOD-13 a bad subject is a caller bug: nothing rolled", () => {
    const { s, rollWith } = setup();
    const n = count(s, "roll");
    const err = (() => {
      try {
        rollWith([], { subject: { creature: MIRA, roll: "ac" } as unknown as RollSubject });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).code).toBe("internal");
    expect(count(s, "roll")).toBe(n);
  });

  test("FR-MOD-13 more than 20 parts on one roll → conflict, nothing stored", () => {
    const { s, rollWith } = setup();
    const many: RollHook = {
      id: "test.many",
      adjust: () => ({
        parts: Array.from({ length: 21 }, (_, i) => ({
          effectId: `fx${i}`,
          label: "Plus",
          public: true,
          value: 1,
        })),
        modes: [],
      }),
    };
    const n = count(s, "roll");
    expect(() => rollWith([many])).toThrow(/At most 20/);
    expect(count(s, "roll")).toBe(n);
  });

  test("FR-DICE-25 same seed + same hooks → identical rolls and entries", () => {
    const run = () => {
      const { s, rollWith } = setup("det");
      rollWith([blessHook([]), cursedHook]);
      return {
        rolls: rolls(s).map((r) => [r.id, r.expression, r.total, r.label]),
        payload: entries(s).map((e) => e.payload),
      };
    };
    expect(run()).toEqual(run());
  });
});
