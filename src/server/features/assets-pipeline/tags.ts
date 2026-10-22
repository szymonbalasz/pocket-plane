// Image tags (ASSET §6.3): the campaign's tag set and spelling (FR-ASSET-39), tags added by an
// upload (FR-ASSET-41) and the DM intents `assets.setTags` / `renameTag` / `deleteTag`
// (FR-ASSET-42, -43). Tags are values on `asset.tags`, not records (ASSET §8).

import {
  ASSET_INTENTS,
  BUILT_IN_TAG_MESSAGE,
  CAMPAIGN_TAGS_MAX,
  DeleteTagIntent,
  type DroppedTag,
  IMAGE_TAGS,
  isBuiltInTag,
  RenameTagIntent,
  SetTagsIntent,
  TAG_NOT_FOUND_MESSAGE,
  TAGS_PER_IMAGE_MAX,
  type TagChangeResult,
  TOO_MANY_TAGS_MESSAGE,
  tagKey,
} from "@shared/assets-pipeline/tags";
import { AssetTagDeleted, AssetTagRenamed, AssetTagsSet } from "@shared/events/assets-pipeline";
import { and, asc, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { asset } from "../../db/schema";
import type { Actor } from "../../events/types";
import { assetUpsert } from "./records";

type AssetRow = typeof asset.$inferSelect;

/** Fold → spelling of every tag in the campaign: the built-ins, then each row's (seq order). */
export type TagSpellings = Map<string, string>;

export function campaignTagSpellings(
  tx: Pick<Tx, "select">,
  campaignId: string,
  except?: string,
): TagSpellings {
  const m: TagSpellings = new Map(IMAGE_TAGS.map((t) => [tagKey(t), t]));
  const rows = tx
    .select({ id: asset.id, tags: asset.tags })
    .from(asset)
    .where(eq(asset.campaignId, campaignId))
    .orderBy(asc(asset.seq))
    .all();
  for (const r of rows) {
    if (r.id === except) continue;
    for (const t of r.tags ?? []) if (!m.has(tagKey(t))) m.set(tagKey(t), t);
  }
  return m;
}

/** FR-ASSET-39: a tag fold-equal to one in the campaign takes that spelling. */
const spell = (m: TagSpellings, tag: string) => m.get(tagKey(tag)) ?? tag;

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t, i) => tagKey(t) === tagKey(b[i] as string));

/**
 * FR-ASSET-41: `add` joined onto `current` (union, campaign spelling). A tag past 8 on the image
 * or a new DM tag past the campaign cap is dropped, never failing the upload. `m` is updated.
 */
export function addTags(
  current: readonly string[],
  add: readonly string[],
  m: TagSpellings,
): { tags: string[]; dropped: DroppedTag[] } {
  const tags = [...current];
  const held = new Set(current.map(tagKey));
  const dropped: DroppedTag[] = [];
  for (const raw of add) {
    const k = tagKey(raw);
    if (held.has(k)) continue;
    const tag = spell(m, raw);
    if (tags.length >= TAGS_PER_IMAGE_MAX) {
      dropped.push({ tag, reason: "image-full" });
    } else if (!m.has(k) && m.size >= CAMPAIGN_TAGS_MAX) {
      dropped.push({ tag, reason: "campaign-full" });
    } else {
      tags.push(tag);
      held.add(k);
      m.set(k, tag);
    }
  }
  return { tags, dropped };
}

function campaignOf(actor: Actor): string {
  if (!actor.campaignId) throw conflict("No active campaign");
  return actor.campaignId;
}

function campaignRows(tx: Pick<Tx, "select">, campaignId: string): AssetRow[] {
  return tx
    .select()
    .from(asset)
    .where(eq(asset.campaignId, campaignId))
    .orderBy(asc(asset.seq))
    .all();
}

/** Writes each changed row's tags; returns the rows as written. */
function writeTags(tx: Tx, changed: { row: AssetRow; tags: string[] }[]): AssetRow[] {
  return changed.map(({ row, tags }) => {
    tx.update(asset).set({ tags }).where(eq(asset.id, row.id)).run();
    return { ...row, tags };
  });
}

/**
 * FR-ASSET-42 `assets.setTags {assetId, tags}`: whole replace, campaign spelling; same tags (by
 * fold, same order) → `ack`, no event. A new DM tag past 50 distinct → `conflict`.
 */
export const setTags = defineCommand({
  name: ASSET_INTENTS.setTags,
  input: SetTagsIntent,
  execute({ assetId, tags }, { tx, actor, emit }): void {
    const campaignId = campaignOf(actor);
    // FR-ASSET-60 (sprint 8): a sound has no tags; it answers as an unknown asset.
    const row = tx
      .select()
      .from(asset)
      .where(and(eq(asset.id, assetId), eq(asset.campaignId, campaignId), eq(asset.kind, "image")))
      .get();
    if (!row) throw notFound("Asset not found");
    const all = campaignTagSpellings(tx, campaignId);
    const next = tags.map((t) => spell(all, t));
    if (row.tags !== null && sameTags(row.tags, next)) return;
    const after = campaignTagSpellings(tx, campaignId, row.id);
    for (const t of next) if (!after.has(tagKey(t))) after.set(tagKey(t), t);
    if (after.size > CAMPAIGN_TAGS_MAX) throw conflict(TOO_MANY_TAGS_MESSAGE);
    const [written] = writeTags(tx, [{ row, tags: next }]) as [AssetRow];
    emit({
      type: AssetTagsSet.type,
      campaignId,
      payload: { assetId, tags: next },
      changes: assetUpsert(written),
    });
  },
});

/**
 * FR-ASSET-43 `assets.renameTag {from, to}`: every asset of the campaign (listed and attachments)
 * holding `from` gets `to` in its place, or just loses `from` if it holds `to` (merge). A
 * fold-equal `to` respells. Never adds a tag to the campaign, so no cap check.
 */
export const renameTag = defineCommand({
  name: ASSET_INTENTS.renameTag,
  input: RenameTagIntent,
  execute({ from, to }, { tx, actor, emit }): TagChangeResult {
    const campaignId = campaignOf(actor);
    if (isBuiltInTag(from)) throw invalid(BUILT_IN_TAG_MESSAGE);
    const fromKey = tagKey(from);
    const rows = campaignRows(tx, campaignId);
    const holders = rows.filter((r) => (r.tags ?? []).some((t) => tagKey(t) === fromKey));
    if (holders.length === 0) throw notFound(TAG_NOT_FOUND_MESSAGE);
    const spellings = campaignTagSpellings(tx, campaignId);
    const fromSpelling = spell(spellings, from);
    const target = tagKey(to) === fromKey ? to : spell(spellings, to);
    const targetKey = tagKey(target);
    const changed: { row: AssetRow; tags: string[] }[] = [];
    for (const row of holders) {
      const cur = row.tags ?? [];
      const merge = targetKey !== fromKey && cur.some((t) => tagKey(t) === targetKey);
      const tags = merge
        ? cur.filter((t) => tagKey(t) !== fromKey)
        : cur.map((t) => (tagKey(t) === fromKey ? target : t));
      if (tags.join("\n") !== cur.join("\n")) changed.push({ row, tags });
    }
    if (changed.length === 0) return { changed: 0 };
    const written = writeTags(tx, changed);
    emit({
      type: AssetTagRenamed.type,
      campaignId,
      payload: { from: fromSpelling, to: target, assetIds: written.map((r) => r.id) },
      changes: written.flatMap(assetUpsert),
    });
    return { changed: written.length };
  },
});

/** FR-ASSET-43 `assets.deleteTag {tag}`: removed from every asset (built-ins too). */
export const deleteTag = defineCommand({
  name: ASSET_INTENTS.deleteTag,
  input: DeleteTagIntent,
  execute({ tag }, { tx, actor, emit }): TagChangeResult {
    const campaignId = campaignOf(actor);
    const key = tagKey(tag);
    const holders = campaignRows(tx, campaignId).filter((r) =>
      (r.tags ?? []).some((t) => tagKey(t) === key),
    );
    if (holders.length === 0) throw notFound(TAG_NOT_FOUND_MESSAGE);
    const spelling = spell(campaignTagSpellings(tx, campaignId), tag);
    const written = writeTags(
      tx,
      holders.map((row) => ({
        row,
        tags: (row.tags ?? []).filter((t) => tagKey(t) !== key),
      })),
    );
    emit({
      type: AssetTagDeleted.type,
      campaignId,
      payload: { tag: spelling, assetIds: written.map((r) => r.id) },
      changes: written.flatMap(assetUpsert),
    });
    return { changed: written.length };
  },
});
