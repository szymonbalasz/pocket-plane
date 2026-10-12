// combat-tracker (CBT): encounters (REST), combat intents, record types `encounter`,
// `encounter-entry`, `combatant`, `hp-change`; token-changed and definition-changed hooks
// (registered in scenes-map's / entities' append-only registries).
import type { Feature } from "../../services";
import { createEncounter, deleteEncounter, updateEncounter } from "./encounters";
import { endCommand, startCommand } from "./lifecycle";
import { combatRecordTypes } from "./records";

export const combatTracker: Feature = {
  name: "combat-tracker",
  register(r) {
    r.command(createEncounter);
    r.command(updateEncounter);
    r.command(deleteEncounter);
    for (const c of [startCommand, endCommand]) r.command(c, { intent: true });
    for (const t of combatRecordTypes) r.recordType(t);
  },
};
