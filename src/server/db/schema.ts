// Drizzle schema. Shared file (AGENTS §9.9). Entities and rules: docs/data-model/README.md.
// Timestamps are ISO-8601 UTC strings from ctx.clock.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const campaign = sqliteTable(
  "campaign",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    // FR-CAMP-06: unique case-insensitive (ASCII in SQLite; commands also compare Unicode-folded).
    uniqueIndex("campaign_name_ci").on(sql`lower(${t.name})`),
    // FR-CAMP-08: at most one active campaign.
    uniqueIndex("campaign_one_active").on(t.active).where(sql`active = 1`),
  ],
);

export const player = sqliteTable(
  "player",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    name: text("name").notNull(),
    /** Never in a sync record, event or log entry (FR-CAMP-13). */
    linkToken: text("link_token").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("player_campaign_name_ci").on(t.campaignId, sql`lower(${t.name})`),
    uniqueIndex("player_link_token").on(t.linkToken),
  ],
);

/** Append-only. `seq` = insertion order, the time-order tiebreak (ADR-0022, CON-04). */
export const eventLog = sqliteTable(
  "event_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    /** Null for global events (imported definitions, ADR-0018). */
    campaignId: text("campaign_id").references((): AnySQLiteColumn => campaign.id),
    type: text("type").notNull(),
    at: text("at").notNull(),
    /** JSON leaf: the domain event payload, zod-validated on write. */
    payload: text("payload", { mode: "json" }).notNull(),
    actorRole: text("actor_role", { enum: ["dm", "player", "system"] }).notNull(),
    actorPlayerId: text("actor_player_id").references((): AnySQLiteColumn => player.id),
    intentId: text("intent_id"),
  },
  (t) => [uniqueIndex("event_log_id").on(t.id), index("event_log_campaign").on(t.campaignId)],
);

/** Test mode only (FR-SYNC-27). */
export const syncProbe = sqliteTable(
  "sync_probe",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    text: text("text").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull(),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
  },
  (t) => [index("sync_probe_campaign").on(t.campaignId)],
);

/**
 * Asset (assets-pipeline, data model §10). `id` = 128-bit capability from ctx.tokens (CON-19).
 * `seq` = insertion order, assigned by the DB at insert (CON-20: `assetSeqNext`). `hash` is
 * server-only. Files live on disk under PP_ASSET_DIR/<hash>/ (FR-ASSET-04).
 */
export const asset = sqliteTable(
  "asset",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    displayWidth: integer("display_width").notNull(),
    displayHeight: integer("display_height").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    // FR-ASSET-03: dedupe per campaign.
    uniqueIndex("asset_campaign_hash").on(t.campaignId, t.hash),
    uniqueIndex("asset_seq").on(t.seq),
    index("asset_campaign").on(t.campaignId),
  ],
);

/** CON-20: `seq` value for an asset insert, computed by the DB inside the insert's transaction. */
export const assetSeqNext = sql<number>`(select coalesce(max(${asset.seq}), 0) + 1 from ${asset})`;

/**
 * Entity (entities, data model §11): one table for imported, custom and character definitions
 * (ADR-0009 storage A). `campaignId` null iff imported (ADR-0018); provenance inline (CON-18).
 * `statBlock` is a JSON leaf, validated per kind by `@shared/entities` on write and read.
 */
export const entity = sqliteTable(
  "entity",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["character", "monster"] }).notNull(),
    campaignId: text("campaign_id").references((): AnySQLiteColumn => campaign.id),
    name: text("name").notNull(),
    portraitAssetId: text("portrait_asset_id").references((): AnySQLiteColumn => asset.id),
    statBlock: text("stat_block", { mode: "json" }).notNull(),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
    hpCurrent: integer("hp_current"),
    /** Plain id, no FK (informational). */
    derivedFromId: text("derived_from_id"),
    source: text("source"),
    sourceKey: text("source_key"),
    licence: text("licence"),
    attribution: text("attribution"),
    importedAt: text("imported_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    // FR-ENT-08: unique ci per (campaign, kind); imported names don't count.
    uniqueIndex("entity_campaign_kind_name_ci")
      .on(t.campaignId, t.kind, sql`lower(${t.name})`)
      .where(sql`campaign_id is not null`),
    // FR-ENT-05, FR-FIX-20: provenance unique globally (nulls for customs).
    uniqueIndex("entity_source_key").on(t.source, t.sourceKey),
    index("entity_campaign").on(t.campaignId),
  ],
);

export const schema = { campaign, player, eventLog, syncProbe, asset, entity };
