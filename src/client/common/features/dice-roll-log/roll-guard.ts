// FR-DICE-22 (sprint 14 F3, after F4's server roll guard, FR-DICE-13 / #367 / #371): the DM's roll
// bar shows its public switch off and disabled while the server would force the roll DM-only
// (rolling as a hidden or renamed monster). The rule is the server's own
// (`@shared/dice-roll-log/roll-guard`); this module only feeds it the DM's store: the roll bar's
// actor as the server resolves it (`dice.roll`: a token as itself; a combatant as its entity under
// its name; a definition under its name) and the visibility facts the DM holds. Hidden for players
// here = `hidden`, or fogged for every player (`fogged`); a token only some players see is DM-only
// on the server without the switch showing it (per-player `seenBy` never leaves it, FR-FOG-44).

import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { actorGuarded, type GuardActor, type GuardWorld } from "@shared/dice-roll-log/roll-guard";
import type { DefinitionRecord } from "@shared/entities/schemas";
import type { SceneView, TokenView } from "@shared/scenes-map/schemas";
import type { ActorOption } from "./logic";

type GuardTokenView = TokenView & { fogged?: true };

export interface RollBarGuardInput {
  ref: ActorOption["ref"] | undefined;
  tokens: readonly GuardTokenView[];
  combatants: readonly CombatantRecord[];
  encounters: readonly Pick<EncounterRecord, "id" | "status">[];
  scenes: readonly Pick<SceneView, "id" | "active">[];
  /** The definitions the store holds (campaign + loaded imported), by id. */
  definitions: ReadonlyMap<string, Pick<DefinitionRecord, "name" | "kind">>;
}

/** The definition ids the guard needs for `ref` (to load imported ones). */
export function rollBarGuardIds(input: Omit<RollBarGuardInput, "definitions">): string[] {
  const { ref } = input;
  if (!ref) return [];
  if ("entityId" in ref) return [ref.entityId];
  if ("tokenId" in ref) {
    const id = input.tokens.find((t) => t.id === ref.tokenId)?.definitionId;
    return id ? [id] : [];
  }
  const c = input.combatants.find((x) => x.id === ref.combatantId);
  return c ? [c.entityId] : [];
}

/** True iff a `dice.roll` as `ref` would be stamped DM-only by the server's roll guard. */
export function rollBarGuarded(input: RollBarGuardInput): boolean {
  const { ref, tokens, combatants, definitions } = input;
  if (!ref) return false;
  const started = input.encounters.find((e) => e.status === "started")?.id ?? null;
  const world: GuardWorld<GuardTokenView, CombatantRecord> = {
    definition(id) {
      const d = definitions.get(id);
      return d ? { name: d.name, monster: d.kind === "monster" } : null;
    },
    combatantsOf: (entityId) =>
      started ? combatants.filter((c) => c.encounterId === started && c.entityId === entityId) : [],
    tokensOf: (entityId) => tokens.filter((t) => t.definitionId === entityId),
    token: (id) => tokens.find((t) => t.id === id) ?? null,
    activeSceneId: () => input.scenes.find((s) => s.active)?.id ?? null,
    tokenHidden: (t) => t.hidden || (t.fogged === true && t.ownerPlayerId === null),
    combatantHidden: (c) => !c.active || c.hidden || c.ownerHidden === true,
  };
  let actor: GuardActor | null = null;
  if ("tokenId" in ref) {
    const t = world.token(ref.tokenId);
    actor = t ? { kind: "token", id: t.id, name: t.name } : null;
  } else if ("combatantId" in ref) {
    const c = combatants.find((x) => x.id === ref.combatantId);
    actor = c ? { kind: "entity", id: c.entityId, name: c.name } : null;
  } else {
    const d = definitions.get(ref.entityId);
    actor = d ? { kind: "entity", id: ref.entityId, name: d.name } : null;
  }
  return actor !== null && actorGuarded(world, actor, false);
}

/** FR-DICE-22: the forced switch's Tooltip. */
export const ROLL_GUARD_HINT = "DM only: this creature is hidden from players or renamed";
