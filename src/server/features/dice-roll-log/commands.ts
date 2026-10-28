// `dice.roll` (FR-DICE-09–13): one roll + one `roll` entry + event-log row in one transaction.

import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  DiceRollIntent,
  type DiceRollResult,
  type DmRollActorRef,
} from "@shared/dice-roll-log/schemas";
import { DiceRolled } from "@shared/events/dice-roll-log";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { forbidden, invalid, notFound } from "../../commands/errors";
import { combatant, entity, player, token } from "../../db/schema";
import { startedEncounter } from "../combat-tracker/rows";
import { resolveDefinition } from "../entities/commands";
import { type EvaluateInput, evaluate, rollPayloadItem } from "./evaluate";
import { append } from "./game-log";
import { campaignOf } from "./settings";

export const ROLL = "dice.roll";

/** FR-DICE-10: who the roll is for; the display name is copied at roll time. */
export function resolveRollActor(
  env: CommandEnv,
  ref: DmRollActorRef | undefined,
): EvaluateInput["actor"] {
  const cid = campaignOf(env.actor);
  if (env.actor.role === "player") {
    const playerId = env.actor.playerId;
    if (!ref) {
      const p = env.tx
        .select({ name: player.name })
        .from(player)
        .where(and(eq(player.id, playerId ?? ""), eq(player.campaignId, cid)))
        .get();
      if (!p) throw notFound("Player not found");
      return { kind: "player", id: playerId, name: p.name };
    }
    if ("combatantId" in ref) throw invalid("Players can't roll as a combatant");
    if (!("entityId" in ref)) throw forbidden("Players roll as themselves or their character");
    const e = env.tx
      .select({ name: entity.name, kind: entity.kind, owner: entity.ownerPlayerId })
      .from(entity)
      .where(and(eq(entity.id, ref.entityId), eq(entity.campaignId, cid)))
      .get();
    // Characters are visible to every player (FR-ENT-15); monsters and other campaigns are not.
    if (e?.kind !== "character") throw notFound("Character not found");
    if (e.owner !== playerId) throw forbidden("Not your character");
    return { kind: "entity", id: ref.entityId, name: e.name };
  }
  if (!ref) return { kind: "dm", id: null, name: "DM" };
  if ("entityId" in ref) {
    const def = resolveDefinition(env, ref.entityId);
    return { kind: "entity", id: def.id, name: def.name };
  }
  if ("combatantId" in ref) {
    // FR-DICE-34: an active, non-removed combatant of the started encounter → an entity actor
    // under the combatant's name ("Goblin 3"); ended or removed since the pick → not_found.
    const enc = startedEncounter(env.tx, cid);
    const c = enc
      ? env.tx
          .select({
            name: combatant.name,
            entityId: combatant.entityId,
            active: combatant.active,
            removed: combatant.removed,
          })
          .from(combatant)
          .where(and(eq(combatant.id, ref.combatantId), eq(combatant.encounterId, enc.id)))
          .get()
      : undefined;
    if (!c?.active || c.removed) throw notFound("Combatant not found");
    return { kind: "entity", id: c.entityId, name: c.name };
  }
  // Any token of the campaign (any scene); its display name is copied. A hidden or renamed
  // monster token's entry is DM-only whatever the public switch (#367, `rollGuarded`).
  const t = env.tx
    .select({ name: token.name })
    .from(token)
    .where(and(eq(token.id, ref.tokenId), eq(token.campaignId, cid)))
    .get();
  if (!t) throw notFound("Token not found");
  return { kind: "token", id: ref.tokenId, name: t.name };
}

export const rollCommand = defineCommand({
  name: ROLL,
  input: DiceRollIntent,
  roles: ["dm", "player"],
  authorize(input, env) {
    // FR-DICE-13: a player-sent `public` → forbidden (player rolls are always public).
    if (env.actor.role === "player" && input.public !== undefined) {
      throw forbidden("Player rolls are always public");
    }
  },
  execute(input, env): DiceRollResult {
    const cid = campaignOf(env.actor);
    const actor = resolveRollActor(env, input.actor);
    const r = evaluate(env, {
      expression: input.expression,
      mode: input.mode,
      category: input.category,
      label: input.label ?? null,
      actor,
      manual: input.manual,
      source: "dice",
    });
    const change = append(env, {
      kind: ROLL_KIND,
      category: input.category,
      actorName: actor.name,
      payload: [rollPayloadItem(r)],
      rollIds: [r.id],
      public: input.public,
    });
    env.emit({
      type: DiceRolled.type,
      campaignId: cid,
      payload: { entryId: change.id, rollIds: [r.id] },
      changes: [change],
    });
    return { rollId: r.id, entryId: change.id };
  },
});
