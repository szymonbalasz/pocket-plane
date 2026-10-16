// Test support for effect-modifiers: CBTX's started ambush (round 1, Wolf's turn) plus preset /
// apply / toggle helpers and a stand-in roll command that calls `dice.evaluate` with a subject
// the way slice 3's callers will (registry hooks, one `roll` entry, part rolls in `rollIds`).
import type { ManualEntry } from "@shared/dice-roll-log/schemas";
import type {
  ApplyInput,
  ApplyResult,
  PresetInput,
  ToggleResult,
} from "@shared/effect-modifiers/intents";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import type { EffectPresetRecord, RollSubject } from "@shared/effect-modifiers/schemas";
import { DiceRolled } from "@shared/events/dice-roll-log";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { effectPreset } from "../../db/schema";
import type { Actor } from "../../events/types";
import { cbtxSetup } from "../combat-extras/testing";
import { dice, type EvaluatedRoll, gameLog } from "../dice-roll-log";
import { toPresetRecord } from "./rows";

/** A test-only roller: `dice.evaluate` with a subject, logged as one public `roll` entry. */
const testRoll = defineCommand({
  name: "test.modRoll",
  input: z.object({
    subject: z.unknown(),
    expression: z.string(),
    manual: z.unknown().optional(),
    actorName: z.string(),
  }),
  roles: ["dm", "player"],
  execute(input, env) {
    const r = dice.evaluate(env, {
      expression: input.expression,
      mode: "normal",
      category: "attack",
      label: "Test roll",
      actor: { kind: "entity", id: "x", name: input.actorName },
      source: "char",
      subject: input.subject as RollSubject,
      ...(input.manual ? { manual: input.manual as ManualEntry } : {}),
    });
    const change = gameLog.append(env, {
      kind: "roll",
      category: "attack",
      actorName: input.actorName,
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
    return { roll: r, entryId: change.id };
  },
});

export function modSetup(opts: { round1?: boolean } = {}) {
  const t = cbtxSetup(opts);
  t.s.commands.register(testRoll);
  let key = 0;
  /** Seeded per call (deterministic dice and ids, AGENTS §9.3). */
  const seeded = <R>(name: string, input: unknown, actor: Actor = t.h.dm) =>
    t.run<R>(name, input, actor, `mod-test-${++key}`);
  const put = (preset: PresetInput, actor: Actor = t.h.dm) =>
    t.run<{ presetId: string }>(MOD_INTENTS.putPreset, { preset }, actor).presetId;
  /** A preset input started from a built-in ("Start from"). */
  const from = (k: string, o: Partial<PresetInput> = {}): PresetInput => {
    const b = builtinPreset(k);
    if (!b) throw new Error(`no built-in ${k}`);
    return {
      characterId: null,
      name: b.name,
      modifiers: b.modifiers,
      durationRounds: b.durationRounds,
      concentration: b.concentration,
      note: b.note,
      ...o,
    };
  };
  const apply = (input: ApplyInput, actor: Actor = t.h.dm) =>
    t.run<ApplyResult>(MOD_INTENTS.apply, input, actor);
  const toggle = (
    characterId: string,
    presetId: string,
    on: boolean,
    actor: Actor = t.h.dm,
    force?: boolean,
  ) =>
    t.run<ToggleResult>(
      MOD_INTENTS.toggle,
      { characterId, presetId, on, ...(force ? { force } : {}) },
      actor,
    );
  const presets = (): EffectPresetRecord[] =>
    t.s.db.select().from(effectPreset).orderBy(asc(effectPreset.seq)).all().map(toPresetRecord);
  const preset = (id: string) => presets().find((p) => p.id === id) as EffectPresetRecord;
  const roll = (
    subject: RollSubject,
    o: { expression?: string; manual?: ManualEntry; actor?: Actor; actorName?: string } = {},
  ) =>
    seeded<{ roll: EvaluatedRoll; entryId: string }>(
      testRoll.name,
      {
        subject,
        expression: o.expression ?? "1d20+4",
        actorName: o.actorName ?? "Mira",
        ...(o.manual ? { manual: o.manual } : {}),
      },
      o.actor,
    );
  /** Bless on Mira and Thorn from Mira, concentration started (like `mod-bless`). */
  const bless = () =>
    apply({
      targets: [{ combatantId: t.id("Mira") }, { combatantId: t.id("Thorn") }],
      preset: { key: "bless" },
      sourceCombatantId: t.id("Mira"),
      startConcentration: true,
    });
  /**
   * A campaign "Hunter's Mark" with the tier-1 +1d6 weapon damage (the built-in is a mark now,
   * FR-MOD-05), applied to Thorn: a bonus die on damage for the roll tests.
   */
  const d6OnThorn = () => {
    const presetId = put({
      characterId: null,
      name: "Hunter's Mark",
      modifiers: [{ kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d6", sign: 1 }],
      durationRounds: null,
      concentration: false,
      note: "",
    });
    return apply({ targets: [{ characterId: t.thornId }], preset: { presetId } });
  };
  return { ...t, seeded, put, from, apply, toggle, presets, preset, roll, bless, d6OnThorn };
}

export type ModSetup = ReturnType<typeof modSetup>;
