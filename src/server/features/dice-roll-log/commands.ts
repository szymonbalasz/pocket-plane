// `dice.roll` (FR-DICE-09–13): one roll + one `roll` entry + event-log row in one transaction.

import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  DiceRollIntent,
  type DiceRollResult,
  type RollActorRef,
} from "@shared/dice-roll-log/schemas";
import { DiceRolled } from "@shared/events/dice-roll-log";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { forbidden, notFound } from "../../commands/errors";
import { entity, player } from "../../db/schema";
import { resolveDefinition } from "../entities/commands";
import { type EvaluateInput, evaluate, rollPayloadItem } from "./evaluate";
import { append } from "./game-log";
import { campaignOf } from "./settings";

export const ROLL = "dice.roll";

/** FR-DICE-10: who the roll is for; the display name is copied at roll time. */
export function resolveRollActor(
  env: CommandEnv,
  ref: RollActorRef | undefined,
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
  // Token actors need scenes-map's token table (not on main yet): until then unknown.
  throw notFound("Token not found");
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
