// MOD tier 2 through real commands (FR-MOD-17, -18, -24, -25; MOD §13 tier 2 rows): Rage's
// advantage on Athletics rolls two d20s, a physical one-d20 entry → `conflict`; `manualParts`
// `e:` groups match or conflict; effective AC on `cbt.applyCard` (`targetAc`, `acMods`, hit hint)
// and the defense preset as a DM fact (the DM's multiplier applies as sent).
import { describe, expect, test } from "bun:test";
import { AttackLogDmPayload } from "@shared/combat-tracker/log-kinds";
import type {
  AttackResult,
  DamageCardPayload,
  HpChangeRecord,
} from "@shared/combat-tracker/schemas";
import { partRollIdsOf } from "@shared/combat-tracker/schemas";
import {
  type DieResult,
  GAME_LOG_ENTRY_TYPE,
  type ManualEntry,
  type ManualPart,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { bonusDieKey } from "@shared/effect-modifiers/rules";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { gameLogEntry, roll } from "../../db/schema";
import { dice, type EvaluatedRoll } from "../dice-roll-log";
import { EFFECTS_CHANGED } from "../dice-roll-log/evaluate";
import { type ModSetup, modSetup } from "./testing";

const entry = (t: ModSetup, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
const items = (t: ModSetup, id: string) => entry(t, id)?.payload as RollEntryPayload;
const rollRow = (t: ModSetup, id: string) =>
  t.s.db.select().from(roll).where(eq(roll.id, id)).get();

/** Thorn (player-2) with their own Rage preset (from the built-in) toggled on. */
function raging() {
  const t = modSetup();
  const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
  t.toggle(t.thornId, rage, true, t.p2);
  const athletics = (o: { manual?: ManualEntry[]; mode?: string } = {}) =>
    t.run<{ entryId: string; rollIds: string[] }>(
      "char.roll",
      { characterId: t.thornId, kind: "skill", skill: "athletics", ...o },
      t.p2,
    );
  return { t, athletics };
}

describe("FR-MOD-17 mode from effects (tier 2)", () => {
  test("FR-MOD-17 Rage: adv on Athletics (STR check) rolls two d20s; line '(adv: Rage)'; Stealth (DEX) stays normal", () => {
    const { t, athletics } = raging();
    const r = athletics();
    const [item] = items(t, r.entryId);
    expect(item?.mode).toBe("advantage");
    expect(item?.expression).toMatch(/^2d20kh1/);
    expect(item?.dice.filter((d) => d.faces === 20)).toHaveLength(2);
    expect(item?.modes).toEqual(["Rage"]);
    expect(rollRow(t, item?.rollId as string)?.mode).toBe("advantage");
    const stealth = t.run<{ entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "skill", skill: "stealth" },
      t.p2,
    );
    expect(items(t, stealth.entryId)[0]?.mode).toBe("normal");
    // A STR save too (Rage's second mode part); Bless-style dice parts are unaffected.
    const save = t.run<{ entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "save", ability: "str" },
      t.p2,
    );
    expect(items(t, save.entryId)[0]?.modes).toEqual(["Rage"]);
  });

  test("FR-MOD-17 physical Athletics with one d20 under Rage → conflict 'Effects changed — roll again', nothing logged; two d20s commit", () => {
    const { t, athletics } = raging();
    const before = t.s.db.select().from(gameLogEntry).all().length;
    const e = t.err(() => athletics({ manual: [{ diceTotal: 14, dice: [14] }] }));
    expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    expect(t.s.db.select().from(gameLogEntry).all()).toHaveLength(before);
    const ok = athletics({ manual: [{ diceTotal: 14, dice: [14, 6] }] });
    expect(items(t, ok.entryId)[0]).toMatchObject({ mode: "advantage", natural: 14, manual: true });
  });

  test("FR-MOD-17 roller's disadvantage + Rage's advantage → normal (one d20, no hint listed)", () => {
    const { t, athletics } = raging();
    const [item] = items(t, athletics({ mode: "disadvantage" }).entryId);
    expect([item?.mode, item?.modes]).toEqual(["normal", undefined]);
  });

  test("FR-MOD-17 Reckless Attack: the attack roll line is adv; damage untouched", () => {
    const t = modSetup();
    t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "reckless" } });
    const r = t.run<AttackResult>("cbt.attack", { attackerId: t.id("Mira") }, t.p1);
    const p = t.note(r.cardId)?.payload as DamageCardPayload;
    const hit = rollRow(t, p.toHit?.rollId as string);
    expect([hit?.mode, (hit?.dice as unknown[] | undefined)?.length]).toEqual(["advantage", 2]);
    expect(rollRow(t, p.damage?.rollId as string)?.mode).toBe("normal");
  });

  test("FR-MOD-17 cbt.attack physical: one d20 previewed normal, Reckless Attack applied before the roll → conflict 'Effects changed — roll again', nothing logged", () => {
    const t = modSetup();
    t.bless();
    const bless = bonusDieKey(
      t
        .active()
        .find((e) => e.kind === "custom" && e.label === "Bless" && e.targetCharacterId === t.miraId)
        ?.id as string,
      0,
      false,
    );
    // As the tier-2 form sends it: the lone d20's value as `dice` (R2 step 4).
    const attack = () =>
      t.run<AttackResult>(
        "cbt.attack",
        {
          attackerId: t.id("Mira"),
          manual: [{ diceTotal: 11, dice: [11] }, { diceTotal: 5 }],
          manualParts: [[{ key: bless, entry: { diceTotal: 2 } }], []],
        },
        t.p1,
      );
    t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "reckless" } });
    const before = t.s.db.select().from(gameLogEntry).all().length;
    const e = t.err(attack);
    expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    expect(t.s.db.select().from(gameLogEntry).all()).toHaveLength(before);
    // Reckless ended again: the same entry fits and commits.
    t.end(t.active().find((x) => x.label === "Reckless Attack")?.id as string);
    const p = t.note(attack().cardId)?.payload as DamageCardPayload;
    expect(rollRow(t, p.toHit?.rollId as string)).toMatchObject({ mode: "normal", total: 15 });
  });
});

describe("FR-MOD-17 a mode only from effects the player can't see (R2 ruling)", () => {
  /** A campaign preset "Foresight" (adv on attacks) on Mira, secret. */
  function foresight() {
    const t = modSetup();
    const presetId = t.put({
      characterId: null,
      name: "Foresight",
      modifiers: [{ kind: "mode", on: { roll: "attack" }, mode: "advantage" }],
      durationRounds: null,
      concentration: false,
    });
    t.apply({ targets: [{ characterId: t.miraId }], preset: { presetId }, secret: true });
    const id = t.active().find((e) => e.label === "Foresight")?.id as string;
    const attack = (asDm = false) =>
      t.run<AttackResult>(
        "cbt.attack",
        {
          attackerId: t.id("Mira"),
          manual: [{ diceTotal: 11, dice: [11] }, { diceTotal: 5 }],
          manualParts: [[], []],
        },
        asDm ? undefined : t.p1,
      );
    return { t, id, attack };
  }
  const playerFrames = (t: ModSetup) =>
    JSON.stringify(
      t.s.db
        .select()
        .from(gameLogEntry)
        .all()
        .map((row) =>
          t.s.records.view(
            GAME_LOG_ENTRY_TYPE,
            { ...row },
            { connId: "p1", campaignId: t.h.campaignId, role: "player", playerId: t.h.p1.id },
          ),
        ),
    );

  test("FR-MOD-17 secret adv on Mira, one physical d20 → the server rolls the second (auto), adv applies, the roll commits; players never see the effect", () => {
    const { t, id, attack } = foresight();
    const p = t.note(attack().cardId)?.payload as DamageCardPayload;
    const hit = rollRow(t, p.toHit?.rollId as string);
    const dice = hit?.dice as DieResult[];
    expect([hit?.mode, hit?.manual, hit?.expression]).toEqual(["advantage", true, "2d20kh1+4"]);
    // The auto die is unseeded and may also show 11: check only the entered die's value.
    expect([dice[0]?.value, ...dice.map((d) => d.auto)]).toEqual([11, undefined, true]);
    const kept = Math.max(11, dice[1]?.value ?? 0);
    expect([hit?.total, hit?.natural]).toEqual([kept + 4, kept]);
    for (const seen of [JSON.stringify(p), playerFrames(t)]) {
      expect(seen).not.toContain("Foresight");
      expect(seen).not.toContain(id);
    }
  });

  test("FR-MOD-17 a visible effect also gives the mode (Reckless Attack) → conflict; a DM roll → conflict", () => {
    const { t, attack } = foresight();
    const dm = t.err(() => attack(true));
    expect([dm.code, dm.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "reckless" } });
    const e = t.err(() => attack());
    expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
  });
});

/** A stand-in roll intent carrying `manualParts` (as R2's tray will send on the real intents). */
const physicalRoll = defineCommand({
  name: "test.modPhysical",
  input: z.object({ subject: z.unknown(), manual: z.unknown(), manualParts: z.unknown() }),
  roles: ["dm", "player"],
  execute(input, env) {
    return dice.evaluate(env, {
      expression: "1d20+4",
      mode: "normal",
      category: "attack",
      label: "Shortsword attack",
      actor: { kind: "entity", id: "x", name: "Mira" },
      source: "char",
      subject: input.subject as RollSubject,
      manual: input.manual as ManualEntry,
      ...(input.manualParts ? { manualParts: input.manualParts as ManualPart[] } : {}),
    });
  },
});

describe("FR-MOD-18 manualParts e: groups (tier 2)", () => {
  function blessed() {
    const t = modSetup();
    t.s.commands.register(physicalRoll);
    t.bless();
    const blessId = t.active().find((e) => e.targetCharacterId === t.miraId && e.kind === "custom")
      ?.id as string;
    const subject: RollSubject = { creature: { characterId: t.miraId }, roll: "attack" };
    const go = (manualParts?: ManualPart[]) =>
      t.run<EvaluatedRoll>(
        physicalRoll.name,
        { subject, manual: { diceTotal: 11, dice: [11] }, manualParts },
        t.p1,
      );
    return { t, blessId, go };
  }

  test("FR-MOD-18 Bless on Mira: group e:<effectId> → its value, physical, not auto, per-die dice", () => {
    const { t, blessId, go } = blessed();
    const key = bonusDieKey(blessId, 0, false);
    expect(key).toBe(`e:${blessId}`);
    const r = go([{ key, entry: { diceTotal: 3, dice: [3] } }]);
    const [p] = r.mods?.parts ?? [];
    expect(p).toMatchObject({ effectId: blessId, value: 3, dice: [3] });
    expect(p?.auto).toBeUndefined();
    expect(rollRow(t, p?.rollId as string)?.manual).toBe(true);
    expect(dice.rollPayloadItem(r).total).toBe(11 + 4 + 3);
  });

  test("FR-MOD-18 mismatch → conflict: no group, a group for an ended effect, 2 dice for 1d4; no manualParts → tier-1 auto", () => {
    const { t, blessId, go } = blessed();
    for (const parts of [
      [],
      [
        { key: `e:${blessId}`, entry: { diceTotal: 3 } },
        { key: "e:gone", entry: { diceTotal: 2 } },
      ],
      [{ key: `e:${blessId}`, entry: { diceTotal: 4, dice: [1, 3] } }],
    ]) {
      const e = t.err(() => go(parts));
      expect([e.code, e.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    }
    expect(go().mods?.parts[0]?.auto).toBe(true);
  });
});

describe("FR-MOD-24/25 target side at apply (tier 2)", () => {
  /** Mira's attack card on a target; the DM applies it with a set to-hit total. */
  function attackOn(t: ModSetup, attacker: string, target: string, toHitTotal: number, hit = true) {
    const r = t.run<AttackResult>("cbt.attack", {
      attackerId: t.id(attacker),
      manual: [{ diceTotal: 10 }, { diceTotal: 3 }],
    });
    const p = t.note(r.cardId)?.payload as DamageCardPayload;
    t.run("cbt.applyCard", {
      cardId: r.cardId,
      toHitTotal,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId ?? null,
      partRollIds: partRollIdsOf(p),
      targets: [{ targetId: t.id(target), hit, multiplier: "normal" }],
    });
    const row = t.hpRows().at(-1) as HpChangeRecord;
    const dm = AttackLogDmPayload.parse(entry(t, row.entryId as string)?.dmPayload);
    return { row, dm, p };
  }

  test("FR-MOD-24 Shield of Faith on Goblin: targetAc = stored + 2, acMods names it, hit hint vs the effective AC", () => {
    const t = modSetup();
    const before = attackOn(t, "Mira", "Goblin", 0);
    const stored = before.row.targetAc as number;
    expect(before.dm.acMods).toBeUndefined();
    const sof = t.apply({
      targets: [{ combatantId: t.id("Goblin") }],
      preset: { key: "shield-of-faith" },
    }).effectIds[0] as string;
    // To-hit = the stored AC: a hit against 15, a miss against 15 + 2.
    const after = attackOn(t, "Mira", "Goblin", stored);
    expect(after.row.targetAc).toBe(stored + 2);
    expect(after.dm.targetAc).toBe(stored + 2);
    expect(after.dm.acMods).toEqual([{ effectId: sof, label: "Shield of Faith", value: 2 }]);
    expect(after.dm.hitComputed).toBe(false);
    expect(after.dm.overrides.hit).toBe(true);
  });

  test("FR-MOD-24 a PC target's AC parts come from its character's effects", () => {
    const t = modSetup();
    t.apply({ targets: [{ characterId: t.miraId }], preset: { key: "shield-of-faith" } });
    const { dm } = attackOn(t, "Goblin", "Mira", 1);
    expect(dm.acMods?.map((m) => [m.label, m.value])).toEqual([["Shield of Faith", 2]]);
  });

  test("FR-MOD-25 Rage on Thorn, slashing hit → defense {resistance, Rage}; the DM's Normal applies as sent; a miss records none", () => {
    const { t } = raging();
    const hit = attackOn(t, "Goblin", "Thorn", 30);
    expect(hit.p.damageType).toBe("slashing");
    expect(hit.dm.defense).toEqual({ level: "resistance", label: "Rage" });
    expect(hit.row).toMatchObject({ multiplier: "normal", raw: hit.p.damage?.total });
    const miss = attackOn(t, "Goblin", "Thorn", 1, false);
    expect(miss.dm.defense).toBeUndefined();
    // Frost Ward-style cold resistance doesn't touch a slashing hit.
    const t2 = modSetup();
    const ward = t2.put({
      characterId: null,
      name: "Frost Ward",
      modifiers: [{ kind: "defense", types: ["cold"], level: "resistance" }],
      durationRounds: null,
      concentration: false,
      note: "",
    });
    t2.apply({ targets: [{ combatantId: t2.id("Wolf") }], preset: { presetId: ward } });
    expect(attackOn(t2, "Mira", "Wolf", 30).dm.defense).toBeUndefined();
  });
});
