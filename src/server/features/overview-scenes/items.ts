// Item commands (OVW §6.3–6.5, §9; protocol §190). DM-only WS intents, except `ovw.moveItems`
// (FR-OVW-35). Each is one transaction, all or nothing, with one event. The server checks bounds
// only; keeping an image's shape is the client's job (FR-OVW-24). IDs and time from ctx.
import {
  OverviewItemsDeleted,
  OverviewItemsMoved,
  OverviewItemsPlaced,
  OverviewItemsUpdated,
} from "@shared/events/overview-scenes";
import {
  DUPLICATE_OFFSET,
  type DuplicateItemsResult,
  ITEMS_PER_CAMPAIGN_MAX,
  ITEMS_PER_OVERVIEW_MAX,
  ItemIdsInput,
  type ItemKind,
  type ItemPatch,
  LabelStyle,
  labelTextFits,
  MINIATURE_SIDE,
  MiniatureStyle,
  MoveItemsInput,
  miniatureNameFits,
  OVW_INTENTS,
  type OverviewItemRecord,
  PlaceImageInput,
  type PlaceItemResult,
  PlaceLabelInput,
  POSITION_MAX,
  type StackMove,
  UpdateItemsInput,
} from "@shared/overview-scenes/schemas";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { overviewItem, overviewItemSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { campaignOf } from "../scenes-map/rows";
import { countItems, getOverview, itemChange, itemsOf, readItem } from "./rows";

export const ITEM_LOCKED = "Item is locked — unlock it first";

/** FR-OVW-15: ≤ 300 per overview and ≤ 3,000 per campaign. */
function assertCaps(env: CommandEnv, cid: string, overviewId: string, adding: number) {
  if (countItems(env.tx, { overviewId }) + adding > ITEMS_PER_OVERVIEW_MAX) {
    throw conflict(`An overview holds at most ${ITEMS_PER_OVERVIEW_MAX} items`);
  }
  if (countItems(env.tx, { campaignId: cid }) + adding > ITEMS_PER_CAMPAIGN_MAX) {
    throw conflict(`A campaign holds at most ${ITEMS_PER_CAMPAIGN_MAX} overview items`);
  }
}

/** FR-OVW-19: the top of a kind's band, for the next item placed on it. */
function nextZ(items: readonly OverviewItemRecord[], kind: ItemKind): number {
  const band = items.filter((i) => i.kind === kind).map((i) => i.z);
  return band.length === 0 ? 0 : Math.max(...band) + 1;
}

type ItemFields = Pick<OverviewItemRecord, "overviewId" | "kind" | "x" | "y"> &
  Partial<
    Pick<
      OverviewItemRecord,
      | "z"
      | "w"
      | "h"
      | "hidden"
      | "locked"
      | "assetId"
      | "text"
      | "style"
      | "characterId"
      | "ownerPlayerId"
      | "shape"
    >
  >;

/** Inserts one item; returns the record. */
function insertItem(env: CommandEnv, cid: string, f: ItemFields): OverviewItemRecord {
  const { tx, ctx } = env;
  const id = ctx.ids.next();
  const now = ctx.clock.iso();
  tx.insert(overviewItem)
    .values({ ...f, id, campaignId: cid, seq: overviewItemSeqNext, createdAt: now, updatedAt: now })
    .run();
  return readItem(tx, id);
}

/**
 * The named items of one overview of the campaign, in the given order. Another campaign's or
 * another overview's item → `not_found`, nothing written (§9).
 */
function itemsOn(
  env: CommandEnv,
  cid: string,
  overviewId: string,
  ids: readonly string[],
): OverviewItemRecord[] {
  getOverview(env.tx, cid, overviewId);
  const byId = new Map(itemsOf(env.tx, overviewId).map((i) => [i.id, i]));
  return ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw notFound("Item not found");
    return item;
  });
}

// ---------- place ----------

/** FR-OVW-22: `assets.require`, bounds, caps; on top of the images. */
export const placeImage = defineCommand({
  name: OVW_INTENTS.placeImage,
  input: PlaceImageInput,
  execute(input, env): PlaceItemResult {
    const cid = campaignOf(env.actor);
    const { id: overviewId } = getOverview(env.tx, cid, input.overviewId);
    const assetId = requireAsset(env, input.assetId).id;
    assertCaps(env, cid, overviewId, 1);
    const after = insertItem(env, cid, {
      overviewId,
      kind: "image",
      z: nextZ(itemsOf(env.tx, overviewId), "image"),
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      hidden: input.hidden ?? false,
      assetId,
    });
    env.emit({
      type: OverviewItemsPlaced.type,
      campaignId: cid,
      payload: { overviewId, itemIds: [after.id] },
      changes: [itemChange(null, after)],
    });
    return { itemId: after.id };
  },
});

/** FR-OVW-25–27: text and style checked by the schema; on top of the labels. */
export const placeLabel = defineCommand({
  name: OVW_INTENTS.placeLabel,
  input: PlaceLabelInput,
  execute(input, env): PlaceItemResult {
    const cid = campaignOf(env.actor);
    const { id: overviewId } = getOverview(env.tx, cid, input.overviewId);
    assertCaps(env, cid, overviewId, 1);
    const after = insertItem(env, cid, {
      overviewId,
      kind: "label",
      z: nextZ(itemsOf(env.tx, overviewId), "label"),
      x: input.x,
      y: input.y,
      hidden: input.hidden ?? false,
      text: input.text,
      style: input.style,
    });
    env.emit({
      type: OverviewItemsPlaced.type,
      campaignId: cid,
      payload: { overviewId, itemIds: [after.id] },
      changes: [itemChange(null, after)],
    });
    return { itemId: after.id };
  },
});

// ---------- update ----------

const refuse = (field: string, kind: ItemKind) =>
  invalid("Invalid input", [{ path: [field], message: `Not on a ${kind}` }]);

/** What each kind may take (FR-OVW-23, -24, -26, -27, -33, -34, -36); all else → `invalid`. */
function assertPatchFits(item: OverviewItemRecord, p: ItemPatch) {
  const { kind } = item;
  if (kind === "label" && (p.w !== undefined || p.h !== undefined)) throw refuse("w", kind);
  if (kind === "label" && p.assetId !== undefined) throw refuse("assetId", kind);
  if (kind === "image" && p.text !== undefined) throw refuse("text", kind);
  if (kind === "image" && p.style !== undefined) throw refuse("style", kind);
  if (kind === "label") {
    if (p.text !== undefined && !labelTextFits(p.text)) {
      throw invalid("Invalid input", [{ path: ["text"], message: "1–80 characters" }]);
    }
    if (p.style !== undefined && !LabelStyle.safeParse(p.style).success) {
      throw invalid("Invalid input", [{ path: ["style"], message: "A label's style has a dot" }]);
    }
  }
  if (kind === "miniature") {
    if (p.text !== undefined && !miniatureNameFits(p.text)) {
      throw invalid("Invalid input", [{ path: ["text"], message: "At most 40 characters" }]);
    }
    if (p.style !== undefined && !MiniatureStyle.safeParse(p.style).success) {
      throw invalid("Invalid input", [{ path: ["style"], message: "A miniature has no dot" }]);
    }
    if (p.w !== undefined || p.h !== undefined) {
      const side = p.w ?? item.w;
      if (
        side === null ||
        side !== (p.h ?? item.h) ||
        side < MINIATURE_SIDE.min ||
        side > MINIATURE_SIDE.max
      ) {
        throw invalid("Invalid input", [
          { path: ["w"], message: `Square, ${MINIATURE_SIDE.min}–${MINIATURE_SIDE.max} units` },
        ]);
      }
    }
    // FR-OVW-33: a linked miniature's name and image are the character's.
    if (item.characterId !== null && (p.text !== undefined || p.assetId !== undefined)) {
      throw conflict("This miniature follows its character");
    }
  }
}

/**
 * FR-OVW-19: new `z` per item that moves: to the top or the bottom of its own band, keeping the
 * moved items' order among themselves. Other items keep theirs.
 */
function stackedZ(
  all: readonly OverviewItemRecord[],
  moves: readonly { item: OverviewItemRecord; stack: StackMove }[],
): Map<string, number> {
  const out = new Map<string, number>();
  const kinds = new Set(moves.map((m) => m.item.kind));
  for (const kind of kinds) {
    const band = all.filter((i) => i.kind === kind).map((i) => i.z);
    const top = Math.max(...band);
    const bottom = Math.min(...band);
    const inBand = (stack: StackMove) =>
      moves
        .filter((m) => m.item.kind === kind && m.stack === stack)
        .map((m) => m.item)
        .sort((a, b) => a.z - b.z || a.seq - b.seq);
    inBand("front").forEach((i, n) => {
      out.set(i.id, top + 1 + n);
    });
    const back = inBand("back");
    back.forEach((i, n) => {
      out.set(i.id, bottom - back.length + n);
    });
  }
  return out;
}

/**
 * FR-OVW-21 Hide / Reveal, Lock / Unlock, To front / To back; FR-OVW-23 resize and Image…;
 * FR-OVW-26, -28 text and style. 1–50 items on one overview, all or nothing. Moving or resizing a
 * locked item → `conflict`. Nothing changes → no event.
 */
export const updateItems = defineCommand({
  name: OVW_INTENTS.updateItems,
  input: UpdateItemsInput,
  execute({ overviewId, items }, env): void {
    const { tx, ctx } = env;
    const cid = campaignOf(env.actor);
    const before = itemsOn(
      env,
      cid,
      overviewId,
      items.map((p) => p.itemId),
    );
    const stacks = items.flatMap((p, i) =>
      p.stack ? [{ item: before[i] as OverviewItemRecord, stack: p.stack }] : [],
    );
    const zs = stackedZ(itemsOf(tx, overviewId), stacks);
    const now = ctx.clock.iso();
    const changes: RecordChange[] = [];
    items.forEach((p, i) => {
      const b = before[i] as OverviewItemRecord;
      assertPatchFits(b, p);
      const placing = [p.x, p.y, p.w, p.h].some((v) => v !== undefined);
      if (placing && b.locked) throw conflict(ITEM_LOCKED);
      const set: Partial<typeof overviewItem.$inferInsert> = {};
      if (p.x !== undefined && p.x !== b.x) set.x = p.x;
      if (p.y !== undefined && p.y !== b.y) set.y = p.y;
      if (p.w !== undefined && p.w !== b.w) set.w = p.w;
      if (p.h !== undefined && p.h !== b.h) set.h = p.h;
      if (p.hidden !== undefined && p.hidden !== b.hidden) set.hidden = p.hidden;
      if (p.locked !== undefined && p.locked !== b.locked) set.locked = p.locked;
      const z = zs.get(b.id);
      if (z !== undefined && z !== b.z) set.z = z;
      if (p.text !== undefined && p.text !== b.text) set.text = p.text;
      if (p.style !== undefined && !Bun.deepEquals(p.style, b.style)) set.style = p.style;
      if (p.assetId !== undefined && p.assetId !== b.assetId) {
        set.assetId = requireAsset(env, p.assetId).id;
      }
      if (Object.keys(set).length === 0) return;
      tx.update(overviewItem)
        .set({ ...set, updatedAt: now })
        .where(eq(overviewItem.id, b.id))
        .run();
      changes.push(itemChange(b, readItem(tx, b.id)));
    });
    if (changes.length === 0) return;
    env.emit({
      type: OverviewItemsUpdated.type,
      campaignId: cid,
      payload: { overviewId, itemIds: changes.map((c) => c.id) },
      changes,
    });
  },
});

// ---------- move ----------

/**
 * FR-OVW-35: a player moves one item: their own miniature, not hidden, on the shown overview.
 * Hidden, on an overview not shown or unknown → `not_found`, checked first (no existence oracle);
 * visible but not theirs → `forbidden`. The DM moves any.
 */
function authorizeMove(
  { overviewId, moves }: { overviewId: string; moves: readonly { itemId: string }[] },
  { tx, actor }: CommandEnv,
): void {
  if (actor.role !== "player") return;
  if (moves.length !== 1) {
    throw invalid("Invalid input", [{ path: ["moves"], message: "One item at a time" }]);
  }
  const cid = campaignOf(actor);
  const row = tx
    .select()
    .from(overviewItem)
    .where(
      and(
        eq(overviewItem.id, (moves[0] as { itemId: string }).itemId),
        eq(overviewItem.overviewId, overviewId),
        eq(overviewItem.campaignId, cid),
      ),
    )
    .get();
  if (!row || row.hidden || !getOverview(tx, cid, overviewId).active) {
    throw notFound("Item not found");
  }
  if (row.kind !== "miniature" || row.ownerPlayerId !== actor.playerId) {
    throw forbidden("Not your miniature");
  }
}

/** FR-OVW-17: 1–50 items, all or nothing; a locked item → `conflict`. Not logged. */
export const moveItems = defineCommand({
  name: OVW_INTENTS.moveItems,
  input: MoveItemsInput,
  roles: ["dm", "player"],
  authorize: authorizeMove,
  execute({ overviewId, moves }, env): void {
    const { tx, ctx } = env;
    const cid = campaignOf(env.actor);
    const before = itemsOn(
      env,
      cid,
      overviewId,
      moves.map((m) => m.itemId),
    );
    if (before.some((i) => i.locked)) throw conflict(ITEM_LOCKED);
    const now = ctx.clock.iso();
    const changes: RecordChange[] = [];
    moves.forEach(({ x, y }, i) => {
      const b = before[i] as OverviewItemRecord;
      if (b.x === x && b.y === y) return;
      tx.update(overviewItem).set({ x, y, updatedAt: now }).where(eq(overviewItem.id, b.id)).run();
      changes.push(itemChange(b, readItem(tx, b.id)));
    });
    if (changes.length === 0) return;
    env.emit({
      type: OverviewItemsMoved.type,
      campaignId: cid,
      payload: { overviewId, itemIds: changes.map((c) => c.id) },
      changes,
    });
  },
});

// ---------- duplicate, delete ----------

const shifted = (v: number) => Math.min(v + DUPLICATE_OFFSET, POSITION_MAX);

/**
 * FR-OVW-21 Duplicate: same picture, text, style, size, hidden and locked flags; a little right
 * and down; on top of its band. A linked miniature's copy loses the link: one per character per
 * overview (FR-OVW-31).
 */
export const duplicateItems = defineCommand({
  name: OVW_INTENTS.duplicateItems,
  input: ItemIdsInput,
  execute({ overviewId, itemIds }, env): DuplicateItemsResult {
    const cid = campaignOf(env.actor);
    const sources = itemsOn(env, cid, overviewId, itemIds);
    assertCaps(env, cid, overviewId, sources.length);
    const changes: RecordChange[] = [];
    for (const src of sources) {
      const {
        id: _id,
        campaignId: _campaignId,
        seq: _seq,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...fields
      } = src;
      const copy = insertItem(env, cid, {
        ...fields,
        x: shifted(src.x),
        y: shifted(src.y),
        z: nextZ(itemsOf(env.tx, overviewId), src.kind),
        characterId: null,
      });
      changes.push(itemChange(null, copy));
    }
    const ids = changes.map((c) => c.id);
    env.emit({
      type: OverviewItemsPlaced.type,
      campaignId: cid,
      payload: { overviewId, itemIds: ids },
      changes,
    });
    return { itemIds: ids };
  },
});

/** FR-OVW-21 Delete: 1–50 items, all or nothing. */
export const deleteItems = defineCommand({
  name: OVW_INTENTS.deleteItems,
  input: ItemIdsInput,
  execute({ overviewId, itemIds }, env): void {
    const cid = campaignOf(env.actor);
    const before = itemsOn(env, cid, overviewId, itemIds);
    for (const b of before) env.tx.delete(overviewItem).where(eq(overviewItem.id, b.id)).run();
    env.emit({
      type: OverviewItemsDeleted.type,
      campaignId: cid,
      payload: { overviewId, itemIds },
      changes: before.map((b) => itemChange(b, null)),
    });
  },
});
