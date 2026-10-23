// party-board commands (PARTY §6, §9): handouts `party.createHandout` / `updateHandout` /
// `shareHandout` / `deleteHandout` and `party.addItem` (DM), and the `handout-shared` notification
// (FR-PARTY-06). `editItem` / `removeItem` / `moveItem` live in `item-commands.ts`; `loot.split`
// in party-loot. *(S5)* Share and delete close lost presents (FR-PARTY-35); share can present to
// the gainers (FR-PARTY-33); `presentHandout` / `closePresent` live in `present-commands.ts`.
import {
  HandoutCreated,
  HandoutDeleted,
  HandoutShared,
  HandoutUpdated,
  PartyItemAdded,
} from "@shared/events/party-board";
import { handoutSharedText, itemAddedText } from "@shared/party-board/format";
import {
  AddItemIntent,
  type AddItemResult,
  CreateHandoutIntent,
  type CreateHandoutResult,
  DeleteHandoutIntent,
  HANDOUT_BODY_TYPE,
  HANDOUT_LIMIT_MESSAGE,
  HANDOUT_MAX,
  HANDOUT_SHARED_KIND,
  HANDOUT_TYPE,
  type HandoutInput,
  ITEM_GONE_MESSAGE,
  NOT_SHARED,
  type PartyItemRecord,
  ShareHandoutIntent,
  UpdateHandoutIntent,
} from "@shared/party-board/schemas";
import { sameShare, shareGainers, shareNotifications } from "@shared/party-board/visibility";
import { LOOT_ENTRY_TYPE, LOOT_RECEIVED_KIND } from "@shared/party-loot/schemas";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { handout, handoutSeqNext, partyItem } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { notify } from "../notifications/helpers";
import { insertItemEntry } from "../party-loot/item-entries";
import {
  requireStores,
  storesCoinChanges,
  storesCoinsBefore,
  storesIds,
} from "../party-loot/stores";
import { type HolderEnd, putToHolder } from "./holders";
import { closeLostPresents, presentTo } from "./presents";
import {
  campaignPlayerIds,
  getHandoutRow,
  handoutCount,
  toHandoutBodyRecord,
  toHandoutRecord,
  toPartyItemRecord,
} from "./rows";

export const PARTY_INTENTS = {
  createHandout: "party.createHandout",
  updateHandout: "party.updateHandout",
  shareHandout: "party.shareHandout",
  deleteHandout: "party.deleteHandout",
  addItem: "party.addItem",
  editItem: "party.editItem",
  removeItem: "party.removeItem",
  moveItem: "party.moveItem",
  presentHandout: "party.presentHandout",
  closePresent: "party.closePresent",
} as const;

export const HANDOUT_NOT_FOUND = "Handout not found";
const WORLD = { kind: "world" } as const;
const PARTY = { kind: "party" } as const;

export function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/** FR-PARTY-02: each image of the actor's campaign (`assets.require`), else `not_found`. */
function requireImages(env: CommandEnv, ids: readonly string[]): void {
  for (const id of ids) requireAsset(env, id);
}

type HandoutRow = NonNullable<ReturnType<typeof getHandoutRow>>;

const header = (r: HandoutRow): RecordChange["after"] => toHandoutRecord(r);
const body = (r: HandoutRow): RecordChange["after"] => toHandoutBodyRecord(r);

function loadHandout(env: CommandEnv, cid: string, id: string): HandoutRow {
  const row = getHandoutRow(env.tx, cid, id);
  if (!row) throw notFound(HANDOUT_NOT_FOUND);
  return row;
}

/** FR-PARTY-03: unshared, `rev` 1, `sharedAt` null; ≤ 200 per campaign. No notification. */
export const createHandout = defineCommand({
  name: PARTY_INTENTS.createHandout,
  input: CreateHandoutIntent,
  execute(input: HandoutInput, env): CreateHandoutResult {
    const cid = campaignOf(env);
    if (handoutCount(env.tx, cid) >= HANDOUT_MAX) throw conflict(HANDOUT_LIMIT_MESSAGE);
    requireImages(env, input.imageAssetIds);
    const id = env.ctx.ids.next();
    const now = env.ctx.clock.iso();
    env.tx
      .insert(handout)
      .values({
        id,
        campaignId: cid,
        seq: handoutSeqNext,
        title: input.title,
        body: input.body,
        imageAssetIds: input.imageAssetIds,
        sharedWith: NOT_SHARED,
        rev: 1,
        bodyRev: 1,
        createdAt: now,
        updatedAt: now,
        sharedAt: null,
      })
      .run();
    const row = loadHandout(env, cid, id);
    env.emit({
      type: HandoutCreated.type,
      campaignId: cid,
      payload: { handoutId: id },
      changes: [
        { type: HANDOUT_TYPE, id, before: null, after: header(row) },
        { type: HANDOUT_BODY_TYPE, id, before: null, after: body(row) },
      ],
    });
    return { handoutId: id };
  },
});

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * FR-PARTY-04: full replacement; same values → `ack`, no write, no event. Else `rev` + 1; the
 * body change only when `body` changed (its record `rev` = the body's own rev).
 */
export const updateHandout = defineCommand({
  name: PARTY_INTENTS.updateHandout,
  input: UpdateHandoutIntent,
  execute({ handoutId, ...input }, env): void {
    const cid = campaignOf(env);
    const before = loadHandout(env, cid, handoutId);
    requireImages(env, input.imageAssetIds);
    const bodyChanged = before.body !== input.body;
    if (
      !bodyChanged &&
      before.title === input.title &&
      sameList(before.imageAssetIds, input.imageAssetIds)
    )
      return;
    const rev = before.rev + 1;
    env.tx
      .update(handout)
      .set({
        title: input.title,
        body: input.body,
        imageAssetIds: input.imageAssetIds,
        rev,
        ...(bodyChanged ? { bodyRev: rev } : {}),
        updatedAt: env.ctx.clock.iso(),
      })
      .where(eq(handout.id, handoutId))
      .run();
    const after = loadHandout(env, cid, handoutId);
    const changes: RecordChange[] = [
      { type: HANDOUT_TYPE, id: handoutId, before: header(before), after: header(after) },
    ];
    if (bodyChanged)
      changes.push({
        type: HANDOUT_BODY_TYPE,
        id: handoutId,
        before: body(before),
        after: body(after),
      });
    env.emit({
      type: HandoutUpdated.type,
      campaignId: cid,
      payload: { handoutId, rev },
      changes,
    });
  },
});

/**
 * FR-PARTY-05 (share and unshare): `players` ids each a player of the campaign (`not_found`);
 * same share → `ack`, no event. `sharedAt` = now iff some player newly gains access. Changes:
 * header + body, so gainers get upserts and losers deletes (FR-PARTY-07). Then FR-PARTY-06:
 * `handout-shared` to the gainers (one to `all` for `none` → `all`), after the event.
 * *(S5)* The losers' presents of this handout go in the same event (FR-PARTY-35); `present: true`
 * then presents to the gainers only (FR-PARTY-33, review #23): `HandoutPresented` last.
 */
export const shareHandout = defineCommand({
  name: PARTY_INTENTS.shareHandout,
  input: ShareHandoutIntent,
  execute({ handoutId, sharedWith, present }, env): void {
    const cid = campaignOf(env);
    const before = loadHandout(env, cid, handoutId);
    const players = campaignPlayerIds(env.tx, cid);
    for (const p of sharedWith.playerIds) {
      if (!players.includes(p)) throw notFound("Player not found");
    }
    if (sameShare(before.sharedWith, sharedWith)) return;
    const gainers = shareGainers(before.sharedWith, sharedWith, players);
    env.tx
      .update(handout)
      .set({ sharedWith, ...(gainers.length > 0 ? { sharedAt: env.ctx.clock.iso() } : {}) })
      .where(eq(handout.id, handoutId))
      .run();
    const after = loadHandout(env, cid, handoutId);
    env.emit({
      type: HandoutShared.type,
      campaignId: cid,
      payload: { handoutId, before: before.sharedWith, after: sharedWith },
      changes: [
        { type: HANDOUT_TYPE, id: handoutId, before: header(before), after: header(after) },
        { type: HANDOUT_BODY_TYPE, id: handoutId, before: body(before), after: body(after) },
        ...closeLostPresents(env, handoutId, sharedWith),
      ],
    });
    const text = handoutSharedText(after.title);
    for (const n of shareNotifications(before.sharedWith, sharedWith, players)) {
      notify(env, {
        kind: HANDOUT_SHARED_KIND,
        audience: n.audience,
        audiencePlayerId: n.audience === "player" ? n.playerId : null,
        text,
        payload: { handoutId },
      });
    }
    if (present === true && gainers.length > 0) presentTo(env, cid, handoutId, gainers);
  },
});

/** FR-PARTY-08: deletes the row; its notifications stay. *(S5)* Its presents too (FR-PARTY-35). */
export const deleteHandout = defineCommand({
  name: PARTY_INTENTS.deleteHandout,
  input: DeleteHandoutIntent,
  execute({ handoutId }, env): void {
    const cid = campaignOf(env);
    const before = loadHandout(env, cid, handoutId);
    const closed = closeLostPresents(env, handoutId, null);
    env.tx.delete(handout).where(eq(handout.id, handoutId)).run();
    env.emit({
      type: HandoutDeleted.type,
      campaignId: cid,
      payload: { handoutId },
      changes: [
        { type: HANDOUT_TYPE, id: handoutId, before: header(before), after: null },
        { type: HANDOUT_BODY_TYPE, id: handoutId, before: body(before), after: null },
        ...closed,
      ],
    });
  },
});

/** The campaign's party row `id`, else `not_found` "Item is gone". */
export function getItem(env: CommandEnv, cid: string, id: string): PartyItemRecord {
  const row = env.tx
    .select()
    .from(partyItem)
    .where(and(eq(partyItem.id, id), eq(partyItem.campaignId, cid)))
    .get();
  if (!row) throw notFound(ITEM_GONE_MESSAGE);
  return toPartyItemRecord(row);
}

/**
 * FR-PARTY-19: merge into the row with the same key (qty sum > 9 999 → `conflict`) or insert
 * (61st row → `conflict`). Writes a `loot-entry` kind `item` `world → party` and a
 * `loot-received` notification to all (after the event, protocol §22). *(S9)* FR-LOOT-37: with
 * `holder` a Stores (`not_found` "Stores are gone" if no such stronghold), `world → stores`, no
 * notification (not in the party's hands); `dmOnly` makes a DM-only Stores row (FR-LOOT-36).
 */
export const addItem = defineCommand({
  name: PARTY_INTENTS.addItem,
  input: AddItemIntent,
  execute({ holder, dmOnly, ...item }, env): AddItemResult {
    const cid = campaignOf(env);
    const end: HolderEnd = holder ?? PARTY;
    if (end.kind === "stores") requireStores(env, cid, end.strongholdId);
    const stores = storesCoinsBefore(env, cid, storesIds(end));
    const { change, after } = putToHolder(env, cid, end, item, dmOnly === true);
    const entry = insertItemEntry(env, cid, WORLD, end, after.name, item.qty, dmOnly === true);
    env.emit({
      type: PartyItemAdded.type,
      campaignId: cid,
      payload: {
        itemId: after.id,
        entryId: entry.id,
        name: after.name,
        qty: item.qty,
        notes: after.notes,
      },
      changes: [
        change,
        { type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry },
        ...storesCoinChanges(env, cid, stores),
      ],
    });
    if (end.kind === "party")
      notify(env, {
        kind: LOOT_RECEIVED_KIND,
        audience: "all",
        text: itemAddedText(after.name, item.qty),
        payload: { entryId: entry.id },
      });
    return { itemId: after.id };
  },
});
