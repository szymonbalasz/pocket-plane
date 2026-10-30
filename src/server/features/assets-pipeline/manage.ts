// Rename and delete an image or a sound (ASSET §6.5, FR-ASSET-62–68; decisions #386, #394):
// DM-only intents `assets.rename` / `assets.delete` / `assets.uses`. Delete only an unused asset
// (OQ-ASSET-05 A): every holder of an asset ID is checked in the command's transaction (FR-ASSET-64).
import { AUDIO_ASSET_TYPE } from "@shared/assets-pipeline/audio";
import {
  ALERT_SOUND_NAMES,
  ASSET_MANAGE_INTENTS,
  type AssetUse,
  AssetUsesIntent,
  type AssetUsesResult,
  DeleteAssetIntent,
  inUseMessage,
  RenameAssetIntent,
} from "@shared/assets-pipeline/manage";
import { AssetDeleted, AssetRenamed } from "@shared/events/assets-pipeline";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import {
  asset,
  campaign,
  combatant,
  compendiumEntry,
  encounter,
  entity,
  handout,
  prop,
  scene,
  token,
} from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";
import { toAssetRecord, toAudioAssetRecord } from "./records";

type AssetRow = typeof asset.$inferSelect;

/** An image or a sound of the actor's campaign (FR-ASSET-67: sounds too, #394). */
function assetOf(tx: Pick<Tx, "select">, actor: Actor, assetId: string): AssetRow {
  if (!actor.campaignId) throw conflict("No active campaign");
  const row = tx
    .select()
    .from(asset)
    .where(and(eq(asset.id, assetId), eq(asset.campaignId, actor.campaignId)))
    .get();
  if (!row) throw notFound("Asset not found");
  return row;
}

const holds = (column: unknown, id: string) =>
  sql`exists (select 1 from json_each(${column}) where value = ${id})`;

/**
 * FR-ASSET-64: everything that uses the image, in ASSET_USE_KINDS order, by name within a kind.
 * An asset ID belongs to one campaign, so the holders are found by the ID alone. Combatants of an
 * ended encounter don't count (history; FR-ASSET-63 clears their image). *(#394)* A sound's only
 * holder: the campaign's alert picks (FR-ASSET-67).
 */
export function assetUses(tx: Pick<Tx, "select">, assetId: string): AssetUse[] {
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);
  const of = (kind: AssetUse["kind"], list: string[]): AssetUse[] =>
    list.map((name) => ({ kind, name }));
  const scenes = tx
    .select({ name: scene.name })
    .from(scene)
    .where(eq(scene.mapAssetId, assetId))
    .orderBy(asc(scene.name))
    .all();
  const props = tx
    .select({ name: scene.name })
    .from(prop)
    .innerJoin(scene, eq(prop.sceneId, scene.id))
    .where(eq(prop.assetId, assetId))
    .orderBy(asc(scene.name))
    .all();
  const tokens = tx
    .select({ name: token.name })
    .from(token)
    .where(eq(token.imageAssetId, assetId))
    .orderBy(asc(token.name))
    .all();
  const portraits = tx
    .select({ name: entity.name })
    .from(entity)
    .where(eq(entity.portraitAssetId, assetId))
    .orderBy(asc(entity.name))
    .all();
  const combatants = tx
    .select({ name: combatant.name })
    .from(combatant)
    .innerJoin(encounter, eq(combatant.encounterId, encounter.id))
    .where(and(eq(combatant.imageAssetId, assetId), ne(encounter.status, "ended")))
    .orderBy(asc(combatant.name))
    .all();
  const handouts = tx
    .select({ name: handout.title })
    .from(handout)
    .where(holds(handout.imageAssetIds, assetId))
    .orderBy(asc(handout.title))
    .all();
  const entries = tx
    .select({ name: compendiumEntry.name })
    .from(compendiumEntry)
    .where(holds(compendiumEntry.imageAssetIds, assetId))
    .orderBy(asc(compendiumEntry.name))
    .all();
  const paused = tx
    .select({ id: campaign.id })
    .from(campaign)
    .where(
      and(
        isNotNull(campaign.pause),
        sql`json_extract(${campaign.pause}, '$.imageAssetId') = ${assetId}`,
      ),
    )
    .all();
  const alerts = tx
    .select({ picks: campaign.alertSounds })
    .from(campaign)
    .all()
    .flatMap((c) =>
      Object.entries(c.picks)
        .filter(([, pick]) => pick === assetId)
        .map(([key]) => ALERT_SOUND_NAMES[key as keyof typeof ALERT_SOUND_NAMES] ?? key),
    );
  return [
    ...of("scene map", names(scenes)),
    // Several props of one scene: one use.
    ...of("prop", [...new Set(names(props))]),
    ...of("token", names(tokens)),
    ...of("portrait", names(portraits)),
    ...of("combatant", names(combatants)),
    ...of("handout", names(handouts)),
    ...of("compendium entry", names(entries)),
    ...paused.map((): AssetUse => ({ kind: "pause card", name: null })),
    ...of("alert sound", alerts),
  ];
}

/** The row's record change (DM): a listed image → `asset`, a sound → `audio-asset` (lazy). */
function change(before: AssetRow, after: AssetRow | null): RecordChange[] {
  if (before.kind === "audio") {
    const b = toAudioAssetRecord(before);
    return [
      {
        type: AUDIO_ASSET_TYPE,
        id: before.id,
        before: b,
        after: after && toAudioAssetRecord(after),
      },
    ];
  }
  if (!before.listed) return [];
  const b = toAssetRecord(before);
  return [{ type: "asset", id: before.id, before: b, after: after && toAssetRecord(after) }];
}

/**
 * FR-ASSET-62 `assets.rename {assetId, name}`: FR-ASSET-08's name rule; the same name → `ack`, no
 * event. Every holder shows the new name (they read it from the record).
 */
export const renameAsset = defineCommand({
  name: ASSET_MANAGE_INTENTS.rename,
  input: RenameAssetIntent,
  execute({ assetId, name }, { tx, actor, emit }): void {
    const row = assetOf(tx, actor, assetId);
    if (row.name === name) return;
    tx.update(asset).set({ name }).where(eq(asset.id, assetId)).run();
    emit({
      type: AssetRenamed.type,
      campaignId: row.campaignId,
      payload: { assetId, name },
      changes: change(row, { ...row, name }),
    });
  },
});

/**
 * FR-ASSET-63, -64 `assets.delete {assetId}`: in use → `conflict` naming the uses, nothing
 * written. Else ended-encounter combatants lose the image, the row goes (its URLs 404 at once,
 * FR-ASSET-13) and the files go at the next start's sweep (FR-ASSET-07).
 */
export const deleteAsset = defineCommand({
  name: ASSET_MANAGE_INTENTS.delete,
  input: DeleteAssetIntent,
  execute({ assetId }, { tx, actor, emit }): void {
    const row = assetOf(tx, actor, assetId);
    const uses = assetUses(tx, assetId);
    if (uses.length > 0) throw conflict(inUseMessage(uses));
    // Ended encounters aren't synced (combat-tracker snapshot: the started one only): no change.
    tx.update(combatant)
      .set({ imageAssetId: null })
      .where(eq(combatant.imageAssetId, assetId))
      .run();
    tx.delete(asset).where(eq(asset.id, assetId)).run();
    emit({
      type: AssetDeleted.type,
      campaignId: row.campaignId,
      payload: { assetId, name: row.name },
      changes: change(row, null),
    });
  },
});

/** FR-ASSET-68 `assets.uses {assetId}` (#394): the Assets window's "Used in" line. Reads only. */
export const assetUsesQuery = defineCommand({
  name: ASSET_MANAGE_INTENTS.uses,
  input: AssetUsesIntent,
  execute({ assetId }, { tx, actor }): AssetUsesResult {
    assetOf(tx, actor, assetId);
    return { uses: assetUses(tx, assetId) };
  },
});
