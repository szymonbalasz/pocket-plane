// dice-roll-log commands and helpers on in-memory services (DICE §13 unit + integration).
import { describe, expect, test } from "bun:test";
import {
  GAME_LOG_ENTRY_TYPE,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogEntryRecord,
  type GameLogSettingsRecord,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { eventLog, gameLogEntry, roll } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import { rollCommand } from "./commands";
import { dice, gameLog } from "./index";
import { SET_CATEGORY_PUBLIC, setCategoryPublic } from "./settings";
import { diceServices, seedDice } from "./testing";

function setup(seed?: string) {
  const { s } = diceServices(seed);
  const seeded = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  return { s, events, ...seeded };
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

describe("FR-DICE-12 public log settings", () => {
  test("FR-DICE-12 no row = all hidden; set → one event; same value → no-op, no event", () => {
    const t = setup();
    const settings = () =>
      t.snapshot(t.viewer("dm"))[GAME_LOG_SETTINGS_TYPE] as GameLogSettingsRecord[];
    expect(settings()).toEqual([
      expect.objectContaining({ id: t.campaignId, campaignId: t.campaignId, attack: false }),
    ]);
    expect(Object.values(settings()[0] ?? {}).filter((v) => v === true)).toEqual([]);
    t.s.commands.run(
      setCategoryPublic,
      { category: "saving-throw", public: true },
      { actor: t.dm },
    );
    expect(settings()[0]?.savingThrow).toBe(true);
    expect(t.events.map((e) => [e.event.type, e.event.payload])).toEqual([
      ["PublicLogCategorySet", { category: "saving-throw", public: true }],
    ]);
    expect(t.events[0]?.event.changes[0]).toMatchObject({
      type: GAME_LOG_SETTINGS_TYPE,
      id: t.campaignId,
      before: { savingThrow: false },
      after: { savingThrow: true },
    });
    t.s.commands.run(
      setCategoryPublic,
      { category: "saving-throw", public: true },
      { actor: t.dm },
    );
    expect(t.events).toHaveLength(1);
    expect(logRows(t.s, "PublicLogCategorySet")).toHaveLength(1);
    t.s.commands.run(
      setCategoryPublic,
      { category: "saving-throw", public: false },
      { actor: t.dm },
    );
    expect(settings()[0]?.savingThrow).toBe(false);
    expect(t.events).toHaveLength(2);
  });

  test("FR-DICE-12 DM only; category enum checked", () => {
    const t = setup();
    expect(
      fail(() =>
        t.s.commands.run(
          SET_CATEGORY_PUBLIC,
          { category: "attack", public: true },
          { actor: t.p1Actor },
        ),
      ).code,
    ).toBe("forbidden");
    expect(
      fail(() =>
        t.s.commands.run(
          SET_CATEGORY_PUBLIC,
          { category: "Attack", public: true },
          { actor: t.dm },
        ),
      ).code,
    ).toBe("invalid");
  });

  test("FR-DICE-16 settings are DM only: never in a player snapshot", () => {
    const t = setup();
    expect(t.snapshot(t.viewer("player", t.p1.id))[GAME_LOG_SETTINGS_TYPE]).toBeUndefined();
  });
});

describe("FR-DICE-09 dice.roll", () => {
  test("FR-DICE-09 one roll + one entry + one event-log row; ack {rollId, entryId}; DiceRolled", () => {
    const t = setup();
    const res = t.s.commands.run(
      rollCommand,
      { expression: "1d20 + 4", category: "attack", label: " Scimitar " },
      { actor: t.dm },
    );
    const [r] = rolls(t.s);
    const [e] = entries(t.s);
    expect(res).toEqual({ rollId: r?.id as string, entryId: e?.id as string });
    expect(r).toMatchObject({
      campaignId: t.campaignId,
      rollerRole: "dm",
      rollerPlayerId: null,
      actorKind: "dm",
      actorName: "DM",
      category: "attack",
      label: "Scimitar",
      source: "dice",
      expression: "1d20+4",
      mode: "normal",
      manual: false,
      constant: 4,
      replacesRollId: null,
    });
    const d = r?.dice as { faces: number; value: number; kept: boolean }[];
    expect(d).toHaveLength(1);
    expect(r?.total).toBe((d[0]?.value ?? 0) + 4);
    expect(r?.natural).toBe(d[0]?.value ?? -1);
    expect(e).toMatchObject({
      n: 1,
      kind: "roll",
      category: "attack",
      public: false,
      undone: false,
      actorName: "DM",
      rollIds: [r?.id],
      dmPayload: null,
      encounterId: null,
      supersededBy: null,
    });
    expect((e?.payload as RollEntryPayload | undefined)?.[0]).toMatchObject({
      rollId: r?.id,
      total: r?.total,
      label: "Scimitar",
    });
    expect(t.events.map((x) => x.event.type)).toEqual(["DiceRolled"]);
    expect(t.events[0]?.event.payload).toEqual({ entryId: e?.id, rollIds: [r?.id] });
    expect(t.events[0]?.event.changes).toEqual([
      { type: GAME_LOG_ENTRY_TYPE, id: e?.id as string, before: null, after: expect.anything() },
    ]);
    expect(logRows(t.s, "DiceRolled")).toHaveLength(1);
  });

  test("FR-DICE-01 FR-DICE-04 invalid input → invalid with the limit message; nothing written", () => {
    const t = setup();
    const cases: [Record<string, unknown>, string][] = [
      [{ expression: "1000d1000" }, "At most 50 dice"],
      [{ expression: "1d20*5" }, "Use NdM"],
      [{ expression: "2d6", mode: "advantage" }, "Advantage needs a d20 roll"],
      [{ expression: "2d6", mode: "disadvantage" }, "Disadvantage needs a d20 roll"],
      [{ expression: "1d20", label: "x".repeat(61) }, "at most 60"],
      [{ expression: "1d20", category: "bogus" }, ""],
      [{ expression: "1d20", extra: 1 }, ""],
    ];
    for (const [input, m] of cases) {
      const err = fail(() => t.s.commands.run("dice.roll", input, { actor: t.dm }));
      expect({ input, code: err.code }).toEqual({ input, code: "invalid" });
      const text = [err.message, ...(err.issues ?? []).map((i) => i.message)].join(" | ");
      expect(text).toContain(m);
    }
    expect(rolls(t.s)).toHaveLength(0);
    expect(entries(t.s)).toHaveLength(0);
    expect(t.events).toHaveLength(0);
  });

  test("FR-DICE-04 advantage: both dice stored, dropped one marked; total from the kept die", () => {
    const t = setup();
    for (const mode of ["advantage", "disadvantage"] as const) {
      t.s.commands.run(rollCommand, { expression: "1d20+3", mode }, { actor: t.dm });
    }
    const [adv, dis] = rolls(t.s).map((r) => ({
      ...r,
      dice: r.dice as { value: number; kept: boolean }[],
    }));
    expect(adv?.expression).toBe("2d20kh1+3");
    expect(dis?.expression).toBe("2d20kl1+3");
    for (const [r, pick] of [
      [adv, Math.max],
      [dis, Math.min],
    ] as const) {
      expect(r?.dice).toHaveLength(2);
      expect(r?.dice.filter((d) => d.kept)).toHaveLength(1);
      const kept = r?.dice.find((d) => d.kept)?.value as number;
      expect(kept).toBe(pick(...(r?.dice.map((d) => d.value) ?? [])));
      expect(r?.total).toBe(kept + 3);
      expect(r?.natural).toBe(kept);
    }
  });

  test("FR-DICE-06 manual: range, die count/faces, kept computed, constants added", () => {
    const t = setup();
    const ok = (input: Record<string, unknown>) => {
      t.s.commands.run("dice.roll", input, { actor: t.dm });
      return rolls(t.s).at(-1);
    };
    expect(ok({ expression: "1d20+2", manual: { diceTotal: 15 } })).toMatchObject({
      manual: true,
      dice: [{ faces: 20, value: 15, kept: true }],
      total: 17,
      natural: 15,
    });
    expect(ok({ expression: "2d6+1", manual: { diceTotal: 9 } })).toMatchObject({
      dice: [
        { faces: 6, value: null, kept: true },
        { faces: 6, value: null, kept: true },
      ],
      total: 10,
      natural: null,
    });
    expect(
      ok({ expression: "1d20", mode: "advantage", manual: { diceTotal: 18, dice: [4, 18] } }),
    ).toMatchObject({
      expression: "2d20kh1",
      dice: [
        { faces: 20, value: 4, kept: false },
        { faces: 20, value: 18, kept: true },
      ],
      total: 18,
      natural: 18,
    });
    const bad: [Record<string, unknown>, string][] = [
      [{ expression: "1d20", manual: { diceTotal: 21 } }, "Dice total must be 1–20"],
      [{ expression: "2d6", manual: { diceTotal: 1 } }, "Dice total must be 2–12"],
      [{ expression: "2d6", manual: { diceTotal: 7, dice: [3] } }, "Enter 2 dice values"],
      [{ expression: "2d6", manual: { diceTotal: 9, dice: [7, 2] } }, "Die 1 must be 1–6"],
      [{ expression: "2d6", manual: { diceTotal: 8, dice: [3, 4] } }, "add up"],
      [
        { expression: "1d20", mode: "advantage", manual: { diceTotal: 4, dice: [4, 18] } },
        "add up",
      ],
    ];
    const before = rolls(t.s).length;
    for (const [input, m] of bad) {
      const err = fail(() => t.s.commands.run("dice.roll", input, { actor: t.dm }));
      expect({ input, code: err.code, message: err.message }).toEqual({
        input,
        code: "invalid",
        message: expect.stringContaining(m),
      });
    }
    expect(rolls(t.s)).toHaveLength(before);
  });

  test("FR-DICE-10 FR-DICE-13 player actor + ownership; player rolls always public", () => {
    const t = setup();
    const run = (input: Record<string, unknown>, actor: Actor = t.p1Actor) =>
      t.s.commands.run(
        "dice.roll",
        { expression: "1d20", category: "skill-check", ...input },
        {
          actor,
        },
      );
    run({});
    run({ actor: { entityId: t.miraId } });
    expect(
      entries(t.s).map((e) => [e.actorName, e.public, e.rollerRole, e.rollerPlayerId]),
    ).toEqual([
      ["Player 1", true, "player", t.p1.id],
      ["Mira", true, "player", t.p1.id],
    ]);
    expect(rolls(t.s).map((r) => [r.actorKind, r.actorId])).toEqual([
      ["player", t.p1.id],
      ["entity", t.miraId],
    ]);
    expect(fail(() => run({ actor: { entityId: t.thornId } })).code).toBe("forbidden");
    expect(fail(() => run({ actor: { entityId: t.goblinId } })).code).toBe("not_found");
    expect(fail(() => run({ actor: { entityId: t.strangerId } })).code).toBe("not_found");
    expect(fail(() => run({ actor: { entityId: "nope" } })).code).toBe("not_found");
    expect(fail(() => run({ actor: { tokenId: "t1" } })).code).toBe("forbidden");
    expect(fail(() => run({ public: true })).code).toBe("forbidden");
    expect(fail(() => run({ public: false })).code).toBe("forbidden");
    expect(entries(t.s)).toHaveLength(2);
  });

  test("FR-DICE-10 DM actors: DM, any definition via resolveDefinition, other campaign not_found", () => {
    const t = setup();
    const run = (actor: unknown) =>
      t.s.commands.run("dice.roll", { expression: "1d6", actor }, { actor: t.dm });
    run({ entityId: t.goblinId });
    run({ entityId: t.thornId });
    t.s.commands.run("dice.roll", { expression: "1d6" }, { actor: t.dm });
    expect(entries(t.s).map((e) => e.actorName)).toEqual(["Goblin", "Thorn", "DM"]);
    expect(fail(() => run({ entityId: t.strangerId })).code).toBe("not_found");
    expect(fail(() => run({ tokenId: "no-such-token" })).code).toBe("not_found");
    expect(fail(() => run({ tokenId: t.otherTokenId })).code).toBe("not_found");
    run({ tokenId: t.tokenId });
    expect(entries(t.s).at(-1)?.actorName).toBe("Boss");
    expect(rolls(t.s).at(-1)).toMatchObject({ actorKind: "token", actorId: t.tokenId });
  });

  test("FR-DICE-13 DM: override wins, else the category setting at commit; DM for a PC too", () => {
    const t = setup();
    const run = (input: Record<string, unknown>) =>
      t.s.commands.run("dice.roll", { expression: "1d20", ...input }, { actor: t.dm });
    t.s.commands.run(setCategoryPublic, { category: "attack", public: true }, { actor: t.dm });
    run({ category: "attack" });
    run({ category: "attack", public: false });
    run({ category: "skill-check" });
    run({ category: "skill-check", public: true });
    run({ category: "initiative", actor: { entityId: t.miraId } });
    t.s.commands.run(setCategoryPublic, { category: "initiative", public: true }, { actor: t.dm });
    run({ category: "initiative", actor: { entityId: t.miraId } });
    expect(entries(t.s).map((e) => e.public)).toEqual([true, false, false, true, false, true]);
  });

  test("FR-DICE-12 category change is not retroactive", () => {
    const t = setup();
    t.s.commands.run(setCategoryPublic, { category: "attack", public: true }, { actor: t.dm });
    t.s.commands.run(rollCommand, { expression: "1d20", category: "attack" }, { actor: t.dm });
    t.s.commands.run(setCategoryPublic, { category: "attack", public: false }, { actor: t.dm });
    t.s.commands.run(rollCommand, { expression: "1d20", category: "attack" }, { actor: t.dm });
    expect(entries(t.s).map((e) => e.public)).toEqual([true, false]);
    const playerView = t.snapshot(t.viewer("player", t.p1.id))[GAME_LOG_ENTRY_TYPE] as unknown[];
    expect(playerView).toHaveLength(1);
  });
});

describe("FR-DICE-15 FR-DICE-17 visibility and window", () => {
  test("FR-DICE-15 DM full; player: public redacted (no dmPayload), hidden absent", () => {
    const t = setup();
    t.s.commands.run(rollCommand, { expression: "1d20", public: true }, { actor: t.dm });
    t.s.commands.run(
      rollCommand,
      { expression: "1d6", public: false, label: "DM-SECRET-ROLL" },
      { actor: t.dm },
    );
    const dm = t.snapshot(t.viewer("dm"))[GAME_LOG_ENTRY_TYPE] as GameLogEntryRecord[];
    const p = t.snapshot(t.viewer("player", t.p2.id))[GAME_LOG_ENTRY_TYPE] as Record<
      string,
      unknown
    >[];
    expect(dm).toHaveLength(2);
    expect(dm[0]).toHaveProperty("dmPayload", null);
    expect(p).toHaveLength(1);
    expect(p[0]).not.toHaveProperty("dmPayload");
    expect(p[0]?.id).toBe(dm[0]?.id as string);
    expect(JSON.stringify(p)).not.toContain("DM-SECRET-ROLL");
    // Another campaign's viewer sees neither.
    expect(t.snapshot(t.viewer("dm", null, t.secondCampaignId))[GAME_LOG_ENTRY_TYPE]).toEqual([]);
  });

  test("FR-DICE-17 n = per-campaign max + 1; window = newest 100 by n, cut before the filter", () => {
    const t = setup();
    for (let i = 0; i < 105; i++) {
      // Every 3rd roll public, so the player's subset is < 100.
      t.s.commands.run(rollCommand, { expression: "1", public: i % 3 === 0 }, { actor: t.dm });
    }
    expect(entries(t.s).map((e) => e.n)).toEqual(Array.from({ length: 105 }, (_, i) => i + 1));
    const dm = t.snapshot(t.viewer("dm"))[GAME_LOG_ENTRY_TYPE] as GameLogEntryRecord[];
    expect(dm.map((e) => e.n)).toEqual(Array.from({ length: 100 }, (_, i) => i + 6));
    const p = t.snapshot(t.viewer("player", t.p1.id))[GAME_LOG_ENTRY_TYPE] as GameLogEntryRecord[];
    const expected = entries(t.s)
      .filter((e) => e.n >= 6 && e.public)
      .map((e) => e.n);
    expect(p.map((e) => e.n)).toEqual(expected);
    expect(p.length).toBeLessThan(100);
    // Second campaign starts its own counter.
    const other: Actor = { ...t.dm, campaignId: t.secondCampaignId };
    t.s.commands.run(rollCommand, { expression: "1" }, { actor: other });
    expect(
      t.s.db
        .select()
        .from(gameLogEntry)
        .where(eq(gameLogEntry.campaignId, t.secondCampaignId))
        .get()?.n,
    ).toBe(1);
  });
});

describe("FR-DICE-19 internal helpers", () => {
  const ProbePayload = z.strictObject({ text: z.string() });
  const helperCommand = (opts: { fail?: boolean; kind?: string; undo?: string } = {}) =>
    defineCommand({
      name: "test.helper",
      input: z.object({}),
      roles: ["dm", "player"],
      execute(_i, env) {
        if (opts.undo) {
          const change = gameLog.markUndone(env, opts.undo);
          env.emit({
            type: "DiceRolled",
            campaignId: env.actor.campaignId,
            payload: { entryId: opts.undo, rollIds: ["x"] },
            changes: [change],
          });
          return change;
        }
        const toHit = dice.evaluate(env, {
          expression: "1d20+4",
          mode: "advantage",
          category: "attack",
          label: "Shortsword",
          actor: { kind: "entity", id: "mira", name: "Mira" },
          source: "char",
          target: { entityId: "gob", name: "Goblin" },
        });
        const dmg = dice.evaluate(env, {
          expression: "1d6+2",
          mode: "normal",
          category: "damage",
          actor: { kind: "entity", id: "mira", name: "Mira" },
          source: "char",
        });
        const change = gameLog.append(env, {
          kind: opts.kind ?? "roll",
          category: "attack",
          actorName: "Mira",
          payload: [dice.rollPayloadItem(toHit), dice.rollPayloadItem(dmg)],
          rollIds: [toHit.id, dmg.id],
          public: false,
        });
        env.emit({
          type: "DiceRolled",
          campaignId: env.actor.campaignId,
          payload: { entryId: change.id, rollIds: [toHit.id, dmg.id] },
          changes: [change],
        });
        if (opts.fail) throw new CommandError("conflict", "caller failed");
        return change;
      },
    });

  test("FR-DICE-26 FR-DICE-19 multi-roll entry via helpers: rolls keep their own categories", () => {
    const t = setup();
    const cmd = helperCommand({});
    t.s.commands.register(cmd);
    t.s.commands.run(cmd, {}, { actor: t.dm });
    const [e] = entries(t.s);
    const rs = rolls(t.s);
    expect(rs.map((r) => [r.category, r.source, r.targetName, r.actorName])).toEqual([
      ["attack", "char", "Goblin", "Mira"],
      ["damage", "char", null, "Mira"],
    ]);
    expect(e).toMatchObject({ category: "attack", rollIds: rs.map((r) => r.id), public: false });
    expect(e?.payload).toHaveLength(2);
  });

  test("FR-DICE-19 helpers commit and roll back with their caller", () => {
    const t = setup();
    const failing = helperCommand({ fail: true });
    t.s.commands.register(failing);
    expect(fail(() => t.s.commands.run(failing, {}, { actor: t.dm })).code).toBe("conflict");
    expect(rolls(t.s)).toHaveLength(0);
    expect(entries(t.s)).toHaveLength(0);
    expect(t.events).toHaveLength(0);
    expect(logRows(t.s, "DiceRolled")).toHaveLength(0);
  });

  test("FR-DICE-18 unregistered kind on write → internal, nothing written", () => {
    const t = setup();
    const cmd = helperCommand({ kind: "cbt.unknown" });
    t.s.commands.register(cmd);
    expect(fail(() => t.s.commands.run(cmd, {}, { actor: t.dm })).code).toBe("internal");
    expect(rolls(t.s)).toHaveLength(0);
    // A registered kind with a bad payload is also internal.
    const bad = defineCommand({
      name: "test.badpayload",
      input: z.object({}),
      execute(_i, env) {
        return gameLog.append(env, {
          kind: "roll",
          category: "other",
          actorName: "X",
          payload: ProbePayload.parse({ text: "not a roll payload" }),
          rollIds: [],
        });
      },
    });
    t.s.commands.register(bad);
    expect(fail(() => t.s.commands.run(bad, {}, { actor: t.dm })).code).toBe("internal");
  });

  test("FR-DICE-19 FR-DICE-13 player caller: entry forced public, internal `public` ignored", () => {
    const t = setup();
    const cmd = helperCommand({});
    t.s.commands.register(cmd);
    t.s.commands.run(cmd, {}, { actor: t.p1Actor });
    expect(entries(t.s)[0]).toMatchObject({ public: true, rollerRole: "player" });
  });

  test("FR-DICE-19 markUndone sets undone in the caller's tx; other campaign → not_found", () => {
    const t = setup();
    const { entryId } = t.s.commands.run(rollCommand, { expression: "1d4" }, { actor: t.dm });
    const undo = helperCommand({ undo: entryId });
    t.s.commands.register(undo);
    t.s.commands.run(undo, {}, { actor: t.dm });
    expect(entries(t.s)[0]?.undone).toBe(true);
    expect(t.events.at(-1)?.event.changes[0]).toMatchObject({
      before: { undone: false },
      after: { undone: true },
    });
    const other = { actor: { ...t.dm, campaignId: t.secondCampaignId } };
    expect(fail(() => t.s.commands.run("test.helper", {}, other)).code).toBe("not_found");
  });
});

describe("FR-DICE-25 determinism", () => {
  test("FR-DICE-25 same seed + same commands → identical rolls, entries and n", () => {
    const runAll = () => {
      const t = setup("same-seed");
      t.s.commands.run(rollCommand, { expression: "2d20kh1+5" }, { actor: t.dm });
      t.s.commands.run(rollCommand, { expression: "8d6", mode: "normal" }, { actor: t.p1Actor });
      t.s.commands.run(rollCommand, { expression: "1d20", mode: "advantage" }, { actor: t.dm });
      return { rolls: rolls(t.s), entries: entries(t.s) };
    };
    const a = runAll();
    expect(runAll()).toEqual(a);
    const t = setup("other-seed");
    t.s.commands.run(rollCommand, { expression: "2d20kh1+5" }, { actor: t.dm });
    t.s.commands.run(rollCommand, { expression: "8d6", mode: "normal" }, { actor: t.p1Actor });
    expect(rolls(t.s).map((r) => r.dice)).not.toEqual(a.rolls.slice(0, 2).map((r) => r.dice));
  });
});
