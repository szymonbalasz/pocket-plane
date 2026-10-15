// combat-tracker (CBT): encounters (REST), combat intents, record types `encounter`,
// `encounter-entry`, `combatant`, `hp-change`; token-changed and definition-changed hooks
// (registered in scenes-map's / entities' append-only registries); the combat rule hook list
// (FR-CBTX-01, ADR-0035) that start / turns / end run.
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { rollAbility } from "./abilities";
import { attackCommand } from "./attack";
import { rollDamageCommand } from "./damage";
import { createEncounter, deleteEncounter, updateEncounter } from "./encounters";
import { applyCard, applyHp, undoCommand } from "./hp";
import { rollInitiative, setInitiative, setRemoved } from "./initiative";
import { endCommandWith, startCommandWith } from "./lifecycle";
import { combatRecordTypes } from "./records";
import { bindCombatRuleHooks, CombatRuleHooks, combatRuleHooks } from "./rule-hooks";
import { turnCommand } from "./turns";

export const combatTracker: Feature = {
  name: "combat-tracker",
  register(r) {
    const hooks = new CombatRuleHooks(combatRuleHooks);
    bindCombatRuleHooks(r.services, hooks);
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
      applyCard,
      applyHp,
      undoCommand,
      rollAbility,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    for (const t of combatRecordTypes) r.recordType(t);
  },
};
