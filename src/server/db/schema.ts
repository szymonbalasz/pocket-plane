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

export const schema = { campaign, player, eventLog, syncProbe };
