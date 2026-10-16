// `dicex.setLook {style, body, pips, material}` (FR-DICEX-26; DM, player): owner = the sender,
// no owner field. Same look → no write, no event; else upsert + event-log row + `DiceLookSet` in
// one transaction (ADR-0016). `dicex.setLookFor` is the fixture loader's way to set a player's
// look (internal: no route, no WS intent), as the player would.
import {
  DICE_LOOK_TYPE,
  DICEX_INTENTS,
  type DiceLook,
  lookKeyOf,
  lookOfRecord,
  SetLookInput,
  type SetLookResult,
  sameLook,
} from "@shared/dice-extras/looks";
import { DiceLookSet } from "@shared/events/dice-extras";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand, IdSchema } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import { diceLook, player } from "../../db/schema";
import { campaignOf } from "../scenes-map/rows";
import { readLook } from "./rows";

function writeLook(
  env: CommandEnv,
  campaignId: string,
  ownerPlayerId: string | null,
  look: DiceLook,
): SetLookResult {
  const { tx, ctx, emit } = env;
  const ownerKey = lookKeyOf(ownerPlayerId);
  const before = readLook(tx, campaignId, ownerKey);
  if (before && sameLook(lookOfRecord(before), look)) return { lookId: before.id };
  const id = before?.id ?? ctx.ids.next();
  const values = { ...look, updatedAt: ctx.clock.iso() };
  tx.insert(diceLook)
    .values({ id, campaignId, ownerKey, ownerPlayerId, ...values })
    .onConflictDoUpdate({ target: [diceLook.campaignId, diceLook.ownerKey], set: values })
    .run();
  emit({
    type: DiceLookSet.type,
    campaignId,
    payload: { lookId: id },
    changes: [{ type: DICE_LOOK_TYPE, id, before, after: readLook(tx, campaignId, ownerKey) }],
  });
  return { lookId: id };
}

export const setLook = defineCommand({
  name: DICEX_INTENTS.setLook,
  input: SetLookInput,
  roles: ["dm", "player"],
  execute(look, env): SetLookResult {
    const cid = campaignOf(env.actor);
    return writeLook(env, cid, env.actor.role === "player" ? env.actor.playerId : null, look);
  },
});

export const SET_LOOK_FOR = "dicex.setLookFor";

/** Internal (fixtures): `dicex.setLook` as the given player of the actor's campaign. */
export const setLookFor = defineCommand({
  name: SET_LOOK_FOR,
  input: z.strictObject({ playerId: IdSchema, look: SetLookInput }),
  execute({ playerId, look }, env): SetLookResult {
    const cid = campaignOf(env.actor);
    const p = env.tx
      .select({ id: player.id })
      .from(player)
      .where(and(eq(player.id, playerId), eq(player.campaignId, cid)))
      .get();
    if (!p) throw notFound("No such player");
    return writeLook(env, cid, p.id, look);
  },
});
