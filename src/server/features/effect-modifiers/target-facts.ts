// MOD's target-side facts at apply (tier 2, FR-MOD-24, -25; registered in combat-tracker's
// `applyHooks`): per target of `cbt.applyCard`, the effective AC (stored AC + Σ `flat` on `ac` of
// its active effects) becomes the row's `targetAc` and the hit hint's, its parts go to the line's
// `dmPayload.acMods`; on a hit, the defense preset for the card's damage type goes to
// `dmPayload.defense`. Facts only: no extra damage, no writes; the DM's multiplier is applied as
// sent (FR-MOD-25). Players never get AC or defense facts (`dmPayload`).
import { AcModPart, DefenseFact } from "@shared/combat-tracker/log-kinds";
import { defenseFor, effectiveAc } from "@shared/effect-modifiers/rules";
import type { ApplyHook, ApplyHookDm } from "../combat-tracker/apply-hooks";
import { activeEffects } from "./roll-hook";

/** `dmPayload.acMods` holds at most this many parts (the AC still counts every one). */
const AC_MODS_MAX = 6;
const FACT_LABEL_MAX = 60;

const clip = (s: string) => (s.length > FACT_LABEL_MAX ? `${s.slice(0, FACT_LABEL_MAX - 1)}…` : s);

export const modTargetFactsHook: ApplyHook = {
  id: "effect-modifiers.target-facts",
  beforeTarget(env, a) {
    const who =
      a.target.kind === "pc" ? { characterId: a.target.entityId } : { combatantId: a.target.id };
    const effects = activeEffects(env, who);
    const ac = effectiveAc(a.targetAc, effects, who);
    const dm: ApplyHookDm = {};
    if (ac.parts.length) {
      dm.acMods = ac.parts
        .slice(0, AC_MODS_MAX)
        .map((p) =>
          AcModPart.parse({ effectId: p.effectId, label: clip(p.label), value: p.value }),
        );
    }
    const defense = a.input.hit ? defenseFor(effects, who, a.card.damageType) : null;
    if (defense)
      dm.defense = DefenseFact.parse({ level: defense.level, label: clip(defense.label) });
    return { extraRaw: 0, parts: [], dm, targetAc: ac.ac, changes: [] };
  },
};
