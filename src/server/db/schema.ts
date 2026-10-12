// Drizzle schema. Shared file (AGENTS §9.9). Entities and rules: docs/data-model/README.md.
// Timestamps are ISO-8601 UTC strings from ctx.clock.
import { DAMAGE_MULTIPLIERS } from "@shared/events/combat-tracker";
import { ROLL_CATEGORIES, ROLL_MODES } from "@shared/events/dice-roll-log";
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

// ---------------------------------------------------------------------------------------------
// Combat (data model §14–§18). Shared definitions only (fix/combat-core); the owning features
// write the rows. `seq` columns = insertion order, assigned by the DB at insert (CON-20): use the
// `*SeqNext` expressions. `n` on game-log entries is the command's own per-campaign counter.
// Scene and token tables don't exist yet: `encounter.sceneId` and `combatant.tokenId` get their
// `ON DELETE SET NULL` FKs when scenes-map adds those tables.
// ---------------------------------------------------------------------------------------------

const ROLE = ["dm", "player"] as const;

/** Roll (dice-roll-log, data model §15): server table, not a record type. Immutable. */
export const roll = sqliteTable(
  "roll",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    at: text("at").notNull(),
    rollerRole: text("roller_role", { enum: ROLE }).notNull(),
    rollerPlayerId: text("roller_player_id").references((): AnySQLiteColumn => player.id),
    actorKind: text("actor_kind", { enum: ["dm", "player", "entity", "token"] }).notNull(),
    /** Plain id, no FK: the name is copied (DICE §8). */
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    targetEntityId: text("target_entity_id"),
    targetTokenId: text("target_token_id"),
    targetName: text("target_name"),
    category: text("category", { enum: ROLL_CATEGORIES }).notNull(),
    label: text("label"),
    source: text("source", { enum: ["dice", "char", "cbt"] }).notNull(),
    expression: text("expression").notNull(),
    mode: text("mode", { enum: ROLL_MODES }).notNull(),
    manual: integer("manual", { mode: "boolean" }).notNull(),
    /** JSON leaf `{faces, value: int | null, kept}[]`, every die incl. dropped (#140). */
    dice: text("dice", { mode: "json" }).notNull(),
    constant: integer("constant").notNull(),
    total: integer("total").notNull(),
    natural: integer("natural"),
    /** Reserved for gems (#140); null in MVP. */
    replacesRollId: text("replaces_roll_id"),
  },
  (t) => [index("roll_campaign").on(t.campaignId)],
);

/** Game log entry (dice-roll-log, `game-log-entry`, data model §15). Window orderBy `n`. */
export const gameLogEntry = sqliteTable(
  "game_log_entry",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    /** Per-campaign counter, max + 1 in the transaction (FR-DICE-17). */
    n: integer("n").notNull(),
    at: text("at").notNull(),
    kind: text("kind").notNull(),
    category: text("category", { enum: ROLL_CATEGORIES }).notNull(),
    /** Stamped once at creation (FR-DICE-13). */
    public: integer("public", { mode: "boolean" }).notNull(),
    undone: integer("undone", { mode: "boolean" }).notNull().default(false),
    rollerRole: text("roller_role", { enum: ROLE }).notNull(),
    rollerPlayerId: text("roller_player_id").references((): AnySQLiteColumn => player.id),
    actorName: text("actor_name").notNull(),
    /** JSON leaf per kind, player-safe. */
    payload: text("payload", { mode: "json" }).notNull(),
    /** JSON leaf, DM only (stripped for players). */
    dmPayload: text("dm_payload", { mode: "json" }),
    /** JSON leaf ID[]; no FK (gate I24). */
    rollIds: text("roll_ids", { mode: "json" }).notNull(),
    encounterId: text("encounter_id").references((): AnySQLiteColumn => encounter.id),
    /** Reserved for gems (#140); null in MVP. */
    supersededBy: text("superseded_by"),
  },
  (t) => [uniqueIndex("game_log_entry_campaign_n").on(t.campaignId, t.n)],
);

/** Public log settings (dice-roll-log, `game-log-settings`): one row per campaign, id = campaignId. */
export const gameLogSettings = sqliteTable("game_log_settings", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .unique()
    .references((): AnySQLiteColumn => campaign.id),
  attack: integer("attack", { mode: "boolean" }).notNull().default(false),
  damage: integer("damage", { mode: "boolean" }).notNull().default(false),
  savingThrow: integer("saving_throw", { mode: "boolean" }).notNull().default(false),
  abilityCheck: integer("ability_check", { mode: "boolean" }).notNull().default(false),
  skillCheck: integer("skill_check", { mode: "boolean" }).notNull().default(false),
  contested: integer("contested", { mode: "boolean" }).notNull().default(false),
  initiative: integer("initiative", { mode: "boolean" }).notNull().default(false),
  healing: integer("healing", { mode: "boolean" }).notNull().default(false),
  other: integer("other", { mode: "boolean" }).notNull().default(false),
});

/** Notification (notifications, data model §16). Window orderBy `seq`, pin pending. */
export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    audience: text("audience", { enum: ["dm", "player", "all"] }).notNull(),
    audiencePlayerId: text("audience_player_id").references((): AnySQLiteColumn => player.id),
    text: text("text").notNull(),
    /** JSON leaf ≤ 1 KB, per-kind zod. */
    payload: text("payload", { mode: "json" }).notNull(),
    actionLabel: text("action_label"),
    actionRole: text("action_role", { enum: ROLE }),
    actionPlayerId: text("action_player_id").references((): AnySQLiteColumn => player.id),
    state: text("state", { enum: ["info", "pending", "resolved", "dismissed"] }).notNull(),
    /** JSON leaf ≤ 256 B, per-kind zod. */
    resolution: text("resolution", { mode: "json" }),
    closedAt: text("closed_at"),
    closedByRole: text("closed_by_role", { enum: ROLE }),
    closedByPlayerId: text("closed_by_player_id").references((): AnySQLiteColumn => player.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("notification_seq").on(t.seq),
    index("notification_campaign_seq").on(t.campaignId, t.seq),
    index("notification_campaign_state").on(t.campaignId, t.state),
  ],
);

/** Encounter (combat-tracker, data model §17). Window orderBy `seq`, pin status ≠ ended. */
export const encounter = sqliteTable(
  "encounter",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["planned", "started", "ended"] }).notNull(),
    /** → scene, ON DELETE SET NULL once scenes-map adds the table. */
    sceneId: text("scene_id"),
    /** JSON leaf ID[] | null (null = every character of the campaign at read time). */
    partyCharacterIds: text("party_character_ids", { mode: "json" }),
    round: integer("round").notNull().default(0),
    turnCombatantId: text("turn_combatant_id"),
    playerTurnCombatantId: text("player_turn_combatant_id"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("encounter_seq").on(t.seq),
    // FR-CBT-07: at most one started encounter per campaign.
    uniqueIndex("encounter_one_started").on(t.campaignId).where(sql`status = 'started'`),
    index("encounter_campaign").on(t.campaignId),
  ],
);

/** Encounter entry (combat-tracker, `encounter-entry`): whole replace on update. */
export const encounterEntry = sqliteTable(
  "encounter_entry",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references((): AnySQLiteColumn => encounter.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    definitionId: text("definition_id")
      .notNull()
      .references((): AnySQLiteColumn => entity.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    uniqueIndex("encounter_entry_seq").on(t.seq),
    index("encounter_entry_encounter").on(t.encounterId),
  ],
);

/** Combatant (combat-tracker, `combatant`): created only by `cbt.start`. */
export const combatant = sqliteTable(
  "combatant",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    encounterId: text("encounter_id")
      .notNull()
      .references((): AnySQLiteColumn => encounter.id),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["pc", "monster"] }).notNull(),
    entityId: text("entity_id")
      .notNull()
      .references((): AnySQLiteColumn => entity.id),
    /** → token, ON DELETE SET NULL once scenes-map adds the table. */
    tokenId: text("token_id"),
    name: text("name").notNull(),
    imageAssetId: text("image_asset_id").references((): AnySQLiteColumn => asset.id),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    removed: integer("removed", { mode: "boolean" }).notNull().default(false),
    initiative: integer("initiative"),
    initRollId: text("init_roll_id"),
    /** Server-written ranks (FR-CBT-13). */
    position: integer("position").notNull(),
    playerPosition: integer("player_position"),
    /** Monsters only (PC HP lives on the character, #92). */
    hpCurrent: integer("hp_current"),
    hpMax: integer("hp_max"),
  },
  (t) => [uniqueIndex("combatant_seq").on(t.seq), index("combatant_encounter").on(t.encounterId)],
);

/** Combat log entry (combat-tracker, `hp_change` / record type `hp-change`): undo + stats unit. */
export const hpChange = sqliteTable(
  "hp_change",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    encounterId: text("encounter_id")
      .notNull()
      .references((): AnySQLiteColumn => encounter.id),
    seq: integer("seq").notNull(),
    at: text("at").notNull(),
    kind: text("kind", { enum: ["damage", "heal"] }).notNull(),
    source: text("source", { enum: ["card", "direct"] }).notNull(),
    cardId: text("card_id").references((): AnySQLiteColumn => notification.id),
    /** JSON leaf ID[]. */
    rollIds: text("roll_ids", { mode: "json" }).notNull(),
    attackerId: text("attacker_id").references((): AnySQLiteColumn => combatant.id),
    attackerName: text("attacker_name"),
    attackName: text("attack_name"),
    damageType: text("damage_type"),
    targetId: text("target_id")
      .notNull()
      .references((): AnySQLiteColumn => combatant.id),
    targetEntityId: text("target_entity_id")
      .notNull()
      .references((): AnySQLiteColumn => entity.id),
    targetName: text("target_name").notNull(),
    targetAc: integer("target_ac").notNull(),
    toHitRolled: integer("to_hit_rolled"),
    toHitTotal: integer("to_hit_total"),
    natural: integer("natural"),
    hitComputed: integer("hit_computed", { mode: "boolean" }),
    hit: integer("hit", { mode: "boolean" }),
    damageRolled: integer("damage_rolled"),
    damageTotal: integer("damage_total").notNull(),
    multiplier: text("multiplier", { enum: DAMAGE_MULTIPLIERS }),
    raw: integer("raw").notNull(),
    applied: integer("applied").notNull(),
    overkill: integer("overkill").notNull(),
    hpBefore: integer("hp_before").notNull(),
    hpAfter: integer("hp_after").notNull(),
    entryId: text("entry_id")
      .notNull()
      .references((): AnySQLiteColumn => gameLogEntry.id),
    /** Undo marker (FR-CBT-25, ADR-0016); the event log stays as is (CON-34). */
    undone: integer("undone", { mode: "boolean" }).notNull().default(false),
    undoneAt: text("undone_at"),
  },
  (t) => [uniqueIndex("hp_change_seq").on(t.seq), index("hp_change_encounter").on(t.encounterId)],
);

/** CON-20: `seq` values for Combat inserts, computed by the DB inside the insert's transaction. */
export const notificationSeqNext = sql<number>`(select coalesce(max(${notification.seq}), 0) + 1 from ${notification})`;
export const encounterSeqNext = sql<number>`(select coalesce(max(${encounter.seq}), 0) + 1 from ${encounter})`;
export const encounterEntrySeqNext = sql<number>`(select coalesce(max(${encounterEntry.seq}), 0) + 1 from ${encounterEntry})`;
export const combatantSeqNext = sql<number>`(select coalesce(max(${combatant.seq}), 0) + 1 from ${combatant})`;
export const hpChangeSeqNext = sql<number>`(select coalesce(max(${hpChange.seq}), 0) + 1 from ${hpChange})`;

export const schema = {
  campaign,
  player,
  eventLog,
  syncProbe,
  asset,
  entity,
  roll,
  gameLogEntry,
  gameLogSettings,
  notification,
  encounter,
  encounterEntry,
  combatant,
  hpChange,
};
