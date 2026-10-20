// combat-tracker (CBT): encounters (REST), combat intents, record types `encounter`,
// `encounter-entry`, `combatant`, `hp-change`, `hit-ruling` (sprint 5); token-changed and definition-changed hooks
// (registered in scenes-map's / entities' append-only registries); the combat rule hook list
// (FR-CBTX-01, ADR-0035) that start / turns / end run; the apply hook list (FR-MOD-38,
// ADR-0043) that apply / undo run.
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { rollAbility } from "./abilities";
import { ApplyHooks, applyHooks, bindApplyHooks } from "./apply-hooks";
import { attackCommand } from "./attack";
import { setCompanionCommand } from "./companions";
import { rollDamageCommand } from "./damage";
import { createEncounter, deleteEncounter, updateEncounter } from "./encounters";
import { applyHitCommand } from "./hit";
import { applyCardWith, applyHp, undoCommandWith } from "./hp";
import { rollInitiative, setInitiative, setRemoved } from "./initiative";
import { endCommandWith, startCommandWith } from "./lifecycle";
import { combatRecordTypes } from "./records";
import { bindCombatRuleHooks, CombatRuleHooks, combatRuleHooks } from "./rule-hooks";
import { setSideCommand } from "./sides";
import { turnCommand } from "./turns";

export const combatTracker: Feature = {
  name: "combat-tracker",
  register(r) {
    const hooks = new CombatRuleHooks(combatRuleHooks);
    bindCombatRuleHooks(r.services, hooks);
    // FR-MOD-38, -41 (ADR-0043): the apply hook list `cbt.applyCard` / `cbt.undo` run.
    const apply = new ApplyHooks(applyHooks);
    bindApplyHooks(r.services, apply);
    r.command(createEncounter);
    r.command(updateEncounter);
    r.command(deleteEncounter);
    const intents: CommandDef[] = [
      startCommandWith(hooks),
      endCommandWith(hooks),
      rollInitiative,
      setInitiative,
      turnCommand("next", hooks),
      turnCommand("prev", hooks),
      setRemoved,
      attackCommand,
      rollDamageCommand,
      applyCardWith(apply),
      applyHp,
      undoCommandWith(apply),
      rollAbility,
      applyHitCommand,
      setSideCommand,
      setCompanionCommand,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    for (const t of combatRecordTypes) r.recordType(t);
  },
};
