// combat-tracker (CBT): encounters (REST), combat intents, record types `encounter`,
// `encounter-entry`, `combatant`, `hp-change`; token-changed and definition-changed hooks
// (registered in scenes-map's / entities' append-only registries).
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { rollAbility } from "./abilities";
import { attackCommand } from "./attack";
import { createEncounter, deleteEncounter, updateEncounter } from "./encounters";
import { applyCard, applyHp, undoCommand } from "./hp";
import { rollInitiative, setInitiative, setRemoved } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";
import { combatRecordTypes } from "./records";
import { nextTurn, prevTurn } from "./turns";

export const combatTracker: Feature = {
  name: "combat-tracker",
  register(r) {
    r.command(createEncounter);
    r.command(updateEncounter);
    r.command(deleteEncounter);
    const intents: CommandDef[] = [
      startCommand,
      endCommand,
      rollInitiative,
      setInitiative,
      nextTurn,
      prevTurn,
      setRemoved,
      attackCommand,
      applyCard,
      applyHp,
      undoCommand,
      rollAbility,
    ];
    for (const c of intents) r.command(c, { intent: true });
    for (const t of combatRecordTypes) r.recordType(t);
  },
};
