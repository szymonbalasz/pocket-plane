// party-board S5 present commands (PARTY §6.6): `party.presentHandout` (DM, FR-PARTY-32) and
// `party.closePresent` (DM, player; FR-PARTY-34). No notification: the popup is the alert.
import { HandoutPresentClosed } from "@shared/events/party-board";
import {
  ClosePresentIntent,
  cantSeeMessage,
  PresentHandoutIntent,
  type PresentHandoutResult,
  SHARE_FIRST_MESSAGE,
} from "@shared/party-board/schemas";
import { audienceOf, sharedWithPlayer } from "@shared/party-board/visibility";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { campaignOf, HANDOUT_NOT_FOUND, PARTY_INTENTS } from "./commands";
import { deletePresents, presentTo } from "./presents";
import { campaignPlayers, getHandoutRow, getPresent, presentsOfHandout } from "./rows";

const PRESENT_NOT_FOUND = "Not found";

/**
 * FR-PARTY-32: targets T = `all` → every player who can see it; `players` → the ids, each a
 * player of the campaign (`not_found`) who can see it (else `conflict` naming them). T empty →
 * `conflict` "Share it first". Per target: old row deleted, new row inserted. Result
 * `{presentIds}` in target order.
 */
export const presentHandout = defineCommand({
  name: PARTY_INTENTS.presentHandout,
  input: PresentHandoutIntent,
  execute({ handoutId, to }, env): PresentHandoutResult {
    const cid = campaignOf(env);
    const row = getHandoutRow(env.tx, cid, handoutId);
    if (!row) throw notFound(HANDOUT_NOT_FOUND);
    const players = campaignPlayers(env.tx, cid);
    let targets: string[];
    if (to.mode === "all") {
      targets = audienceOf(
        row.sharedWith,
        players.map((p) => p.id),
      );
    } else {
      for (const id of to.playerIds) {
        const p = players.find((x) => x.id === id);
        if (!p) throw notFound("Player not found");
        if (!sharedWithPlayer(row.sharedWith, id)) throw conflict(cantSeeMessage(p.name));
      }
      targets = to.playerIds;
    }
    if (targets.length === 0) throw conflict(SHARE_FIRST_MESSAGE);
    return { presentIds: presentTo(env, cid, handoutId, targets) };
  },
});

/**
 * FR-PARTY-34: `{presentId}`: a player closes only their own row (another's → `not_found`), the
 * DM any row of the campaign; `{handoutId}`: DM only (player → `forbidden`), every row of that
 * handout. Nothing left to close → `ack`, no event (two devices closing at once).
 */
export const closePresent = defineCommand({
  name: PARTY_INTENTS.closePresent,
  input: ClosePresentIntent,
  roles: ["dm", "player"],
  execute(input, env): void {
    const cid = campaignOf(env);
    const isDm = env.actor.role === "dm";
    let rows: ReturnType<typeof presentsOfHandout>;
    if ("presentId" in input) {
      const row = getPresent(env.tx, cid, input.presentId);
      if (!row) return;
      if (!isDm && row.playerId !== env.actor.playerId) throw notFound(PRESENT_NOT_FOUND);
      rows = [row];
    } else {
      if (!isDm) throw forbidden();
      rows = presentsOfHandout(env.tx, input.handoutId).filter((r) => r.campaignId === cid);
      if (rows.length === 0) return;
    }
    const first = rows[0] as (typeof rows)[number];
    env.emit({
      type: HandoutPresentClosed.type,
      campaignId: cid,
      payload: {
        handoutId: first.handoutId,
        playerIds: rows.map((r) => r.playerId),
        by: isDm ? "dm" : "player",
      },
      changes: deletePresents(env, rows),
    });
  },
});
