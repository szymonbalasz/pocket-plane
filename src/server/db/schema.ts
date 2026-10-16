// Drizzle schema. Shared file (AGENTS §9.9). Entities and rules: docs/data-model/README.md.
// Timestamps are ISO-8601 UTC strings from ctx.clock.

import { CONDITIONS } from "@shared/combat-extras/conditions";
import {
  type DeathCounters,
  EFFECT_ENDED_REASONS,
  EFFECT_KINDS,
} from "@shared/combat-extras/schemas";
import { HP_MODES, type HpTriggerPart } from "@shared/combat-tracker/schemas";
import type { Modifier } from "@shared/effect-modifiers/schemas";
import { TRIGGER_USE_STATES } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { TOKEN_SHAPES } from "@shared/entities/schemas";
import { DAMAGE_MULTIPLIERS } from "@shared/events/combat-tracker";
import { ROLL_CATEGORIES, ROLL_MODES } from "@shared/events/dice-roll-log";
import { type DoorSeen, FOG_EDIT_KINDS, FOG_FILLS } from "@shared/fog-of-war/schemas";
import type { DarknessRow, FogLayerShape } from "@shared/fog-of-war/shapes";
import { DIAGONAL_RULES, type Door, TEMPLATE_SHAPES, type Wall } from "@shared/scene-tools/schemas";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
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

/**
 * Facts about this DB file, not campaign data (#163). `db-id` = random UUID created on first
 * read; the asset dir carries it as a marker so a sweep never runs against another DB's files.
 */
export const dbMeta = sqliteTable("db_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

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
    /** Character play state (combat-extras, FR-CBTX-14/19), like `hpCurrent`; monsters keep 0. */
    tempHp: integer("temp_hp").notNull().default(0),
    deathSuccesses: integer("death_successes").notNull().default(0),
    deathFailures: integer("death_failures").notNull().default(0),
    /** Default shape for new tokens; null = round (FR-ENT-22). Values checked by zod. */
    tokenShape: text("token_shape", { enum: TOKEN_SHAPES }),
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

/**
 * Creature sheet (character-sheet-full, `creature-sheet`, data model §20): the sheet data that is
 * not rules numbers, 1:1 with a campaign entity (character or custom monster; never imported).
 * A missing row = defaults (ready, unlocked, empty). JSON leaves validated by CHARX's zod on
 * write and read; ≤ 48 KB per row (FR-CHARX-03). `ownerPlayerId` copies the entity's, written
 * only with it (FR-CHARX-13).
 */
export const creatureSheet = sqliteTable(
  "creature_sheet",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references((): AnySQLiteColumn => entity.id),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
    status: text("status", { enum: ["draft", "ready"] }).notNull(),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    background: text("background").notNull().default(""),
    alignment: text("alignment").notNull().default(""),
    /** `{armor, weapons, tools, languages}` */
    proficiencyNotes: text("proficiency_notes", { mode: "json" }).notNull(),
    spells: text("spells", { mode: "json" }).notNull(),
    features: text("features", { mode: "json" }).notNull(),
    items: text("items", { mode: "json" }).notNull(),
    notes: text("notes").notNull().default(""),
    /** `{"1"…"9": int}` */
    slotsUsed: text("slots_used", { mode: "json" }).notNull(),
    /** `{d6…d12: int}` */
    hitDiceUsed: text("hit_dice_used", { mode: "json" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("creature_sheet_campaign").on(t.campaignId)],
);

// ---------------------------------------------------------------------------------------------
// Scenes (scenes-map, data model §12–§13). `seq` = insertion order, DB-assigned (CON-20).
// ---------------------------------------------------------------------------------------------

/** Scene folder: one level (FR-MAP-02). */
export const sceneFolder = sqliteTable(
  "scene_folder",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("scene_folder_seq").on(t.seq),
    index("scene_folder_campaign").on(t.campaignId),
  ],
);

/** Scene: map + grid (FR-MAP-01, -09–11); ≤ 1 active per campaign (FR-MAP-06, OQ-MAP-18). */
export const scene = sqliteTable(
  "scene",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    /** Null = root. Folder delete moves its scenes to the root first (same transaction). */
    folderId: text("folder_id").references((): AnySQLiteColumn => sceneFolder.id),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    mapAssetId: text("map_asset_id")
      .notNull()
      .references((): AnySQLiteColumn => asset.id),
    mapWidth: integer("map_width").notNull(),
    mapHeight: integer("map_height").notNull(),
    gridCellSize: real("grid_cell_size").notNull(),
    gridOffsetX: real("grid_offset_x").notNull(),
    gridOffsetY: real("grid_offset_y").notNull(),
    gridVisible: integer("grid_visible", { mode: "boolean" }).notNull(),
    gridColor: text("grid_color").notNull(),
    gridOpacity: real("grid_opacity").notNull(),
    mapLocked: integer("map_locked", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("scene_seq").on(t.seq),
    uniqueIndex("scene_one_active").on(t.campaignId).where(sql`active = 1`),
    index("scene_campaign").on(t.campaignId),
  ],
);

/** Token: instance of a creature definition on a scene (FR-MAP-13–21, ADR-0024). */
export const token = sqliteTable(
  "token",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    sceneId: text("scene_id")
      .notNull()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    definitionId: text("definition_id")
      .notNull()
      .references((): AnySQLiteColumn => entity.id),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    imageAssetId: text("image_asset_id").references((): AnySQLiteColumn => asset.id),
    size: text("size", {
      enum: ["tiny", "small", "medium", "large", "huge", "gargantuan"],
    }).notNull(),
    col: integer("col").notNull(),
    row: integer("row").notNull(),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    /** Token-owned; from the definition's `tokenShape` at place (FR-MAP-35). */
    shape: text("shape", { enum: TOKEN_SHAPES }).notNull().default("round"),
    /** Display copy of `statBlock.speed`; players: own tokens only (FR-MAP-36). */
    speed: integer("speed"),
    /** Display copy: `definitionId` on character tokens, else null; players see it (FR-MAP-50). */
    characterId: text("character_id"),
    /**
     * Server copy (FR-FOG-10): owned = statically hidden; unowned = seen by no player (statically
     * hidden while the campaign has no players). DM wire (and the owner) only when true.
     */
    fogged: integer("fogged", { mode: "boolean" }).notNull().default(false),
    /** Server copy (FR-FOG-10, ADR-0042): player ids who see it; null = pre-v2 (backfill). Never on a wire. */
    seenBy: text("seen_by", { mode: "json" }).$type<string[]>(),
    /** FR-FOG-45 (#210): DM-only token state; DM wire only when true, never to players. */
    invisible: integer("invisible", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("token_seq").on(t.seq),
    index("token_scene").on(t.sceneId),
    index("token_campaign").on(t.campaignId),
    index("token_definition").on(t.definitionId),
  ],
);

/** CON-20: `seq` values for scene inserts, computed by the DB inside the insert's transaction. */
export const sceneFolderSeqNext = sql<number>`(select coalesce(max(${sceneFolder.seq}), 0) + 1 from ${sceneFolder})`;
export const sceneSeqNext = sql<number>`(select coalesce(max(${scene.seq}), 0) + 1 from ${scene})`;
export const tokenSeqNext = sql<number>`(select coalesce(max(${token.seq}), 0) + 1 from ${token})`;

// ---------------------------------------------------------------------------------------------
// Combat (data model §14–§18). Shared definitions only (fix/combat-core); the owning features
// write the rows. `seq` columns = insertion order, assigned by the DB at insert (CON-20): use the
// `*SeqNext` expressions. `n` on game-log entries is the command's own per-campaign counter.
// `encounter.sceneId` and `combatant.tokenId` → scene / token, `ON DELETE SET NULL`.
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
    /** JSON leaf, per-kind zod; ≤ the kind's `payloadMaxBytes` (default 1 KB, FR-NOTE-03). */
    payload: text("payload", { mode: "json" }).notNull(),
    actionLabel: text("action_label"),
    actionRole: text("action_role", { enum: ROLE }),
    actionPlayerId: text("action_player_id").references((): AnySQLiteColumn => player.id),
    state: text("state", { enum: ["info", "pending", "resolved", "dismissed"] }).notNull(),
    /** JSON leaf, per-kind zod; ≤ the kind's `resolutionMaxBytes` (default 256 B, FR-NOTE-03). */
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
    sceneId: text("scene_id").references((): AnySQLiteColumn => scene.id, {
      onDelete: "set null",
    }),
    /** JSON leaf ID[] | null (null = every character of the campaign at read time). */
    partyCharacterIds: text("party_character_ids", { mode: "json" }),
    round: integer("round").notNull().default(0),
    turnCombatantId: text("turn_combatant_id"),
    playerTurnCombatantId: text("player_turn_combatant_id"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    /** Builder options (FR-CBT-62): Start creates missing monster tokens, hidden. */
    createTokens: integer("create_tokens", { mode: "boolean" }).notNull().default(true),
    addHidden: integer("add_hidden", { mode: "boolean" }).notNull().default(true),
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
    /** FR-CBT-62: `average` = stat block `hpMax`; `rolled` = the `hpFormula` at Start. */
    hpMode: text("hp_mode", { enum: HP_MODES }).notNull().default("average"),
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
    tokenId: text("token_id").references((): AnySQLiteColumn => token.id, {
      onDelete: "set null",
    }),
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
    /** Movement used this turn, 0–9,999 (FR-CBT-39); reset on Next for the new turn combatant. */
    movedFt: integer("moved_ft").notNull().default(0),
    /** Monsters only, 0–999 (FR-CBTX-14); PCs' lives on the character. Never sent to players. */
    tempHp: integer("temp_hp").notNull().default(0),
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
    /** combat-extras (FR-CBTX-21): temp HP around this change; undo restores the difference. */
    tempBefore: integer("temp_before").notNull().default(0),
    tempAfter: integer("temp_after").notNull().default(0),
    /** JSON leaf `{successes, failures}` | null when this change left the counters unchanged. */
    deathBefore: text("death_before", { mode: "json" }).$type<DeathCounters | null>(),
    deathAfter: text("death_after", { mode: "json" }).$type<DeathCounters | null>(),
    /** JSON leaf ID[]: the concentration cards this change created (undo closes pending ones). */
    noteIds: text("note_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /**
     * effect-modifiers (FR-MOD-38, -48): JSON leaf ≤ 4 rule-trigger parts this apply landed on
     * the target (`[]` = none); DM only, like the row.
     */
    triggerParts: text("trigger_parts", { mode: "json" })
      .$type<HpTriggerPart[]>()
      .notNull()
      .default([]),
    entryId: text("entry_id")
      .notNull()
      .references((): AnySQLiteColumn => gameLogEntry.id),
    /** Undo marker (FR-CBT-25, ADR-0016); the event log stays as is (CON-34). */
    undone: integer("undone", { mode: "boolean" }).notNull().default(false),
    undoneAt: text("undone_at"),
  },
  // (encounter, seq): the snapshot window reads the newest 50 without a sort (#163).
  (t) => [
    uniqueIndex("hp_change_seq").on(t.seq),
    index("hp_change_encounter").on(t.encounterId, t.seq),
  ],
);

/**
 * Loot entry (party-loot, `loot-entry`): DM loot / spend (`world → party`) or a coin move. Window
 * orderBy `seq` (CON-20). Pot and wallets are derived sums, never stored (FR-LOOT-09).
 */
export const lootEntry = sqliteTable(
  "loot_entry",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["loot", "move"] }).notNull(),
    fromKind: text("from_kind", { enum: ["party", "world", "character"] }).notNull(),
    /** Plain id, no FK (entities has no delete, FR-ENT-14). */
    fromCharacterId: text("from_character_id"),
    toKind: text("to_kind", { enum: ["party", "world", "character"] }).notNull(),
    toCharacterId: text("to_character_id"),
    text: text("text").notNull(),
    /** Columns, not JSON: summed per coin (LOOT §8). */
    cp: integer("cp").notNull(),
    sp: integer("sp").notNull(),
    ep: integer("ep").notNull(),
    gp: integer("gp").notNull(),
    pp: integer("pp").notNull(),
    createdAt: text("created_at").notNull(),
    editedAt: text("edited_at"),
  },
  (t) => [
    uniqueIndex("loot_entry_seq").on(t.seq),
    index("loot_entry_campaign_seq").on(t.campaignId, t.seq),
  ],
);

/**
 * Effect (combat-extras, `effect`, data model §21): a condition, custom effect or concentration
 * on a monster's combatant or a PC's character. Soft end (`endedAt` + reason) so Prev and undo
 * restore. Partial unique indexes: one active concentration per target, one active condition per
 * (target, key) (CBTX §8). Exactly one target is checked by zod and the commands: a CHECK
 * constraint makes drizzle-kit push rebuild every table. `sourceCombatantId`, `anchorCombatantId`, `endedTurnId` and
 * `endedByHpChangeId` are plain ids (copies at the time).
 */
export const effect = sqliteTable(
  "effect",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: EFFECT_KINDS }).notNull(),
    condition: text("condition", { enum: CONDITIONS }),
    level: integer("level"),
    label: text("label"),
    targetCombatantId: text("target_combatant_id").references((): AnySQLiteColumn => combatant.id, {
      onDelete: "set null",
    }),
    targetCharacterId: text("target_character_id").references((): AnySQLiteColumn => entity.id),
    encounterId: text("encounter_id").references((): AnySQLiteColumn => encounter.id),
    sourceCombatantId: text("source_combatant_id"),
    sourceName: text("source_name"),
    concentrationId: text("concentration_id").references((): AnySQLiteColumn => effect.id, {
      onDelete: "set null",
    }),
    durationRounds: integer("duration_rounds"),
    endsRound: integer("ends_round"),
    anchorCombatantId: text("anchor_combatant_id"),
    secret: integer("secret", { mode: "boolean" }).notNull().default(false),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    endedAt: text("ended_at"),
    endedReason: text("ended_reason", { enum: EFFECT_ENDED_REASONS }),
    endedRound: integer("ended_round"),
    endedTurnId: text("ended_turn_id"),
    endedByHpChangeId: text("ended_by_hp_change_id"),
    /** effect-modifiers (FR-MOD-03): JSON leaf Modifier[] 0–6, `custom` effects only (zod). */
    modifiers: text("modifiers", { mode: "json" }).$type<Modifier[]>().notNull().default([]),
    /** Built-in preset key or preset id it was applied from (soft, no FK; FR-MOD-09). */
    presetKey: text("preset_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("effect_seq").on(t.seq),
    index("effect_campaign").on(t.campaignId),
    index("effect_encounter").on(t.encounterId),
    index("effect_target_combatant").on(t.targetCombatantId),
    index("effect_target_character").on(t.targetCharacterId),
    index("effect_concentration").on(t.concentrationId),
    // FR-CBTX-09: one active concentration per target. Nulls are distinct, so one index per side.
    uniqueIndex("effect_one_concentration_combatant")
      .on(t.targetCombatantId)
      .where(sql`kind = 'concentration' and ended_at is null`),
    uniqueIndex("effect_one_concentration_character")
      .on(t.targetCharacterId)
      .where(sql`kind = 'concentration' and ended_at is null`),
    // FR-CBTX-04: one active condition per (target, key).
    uniqueIndex("effect_one_condition_combatant")
      .on(t.targetCombatantId, t.condition)
      .where(sql`kind = 'condition' and ended_at is null`),
    uniqueIndex("effect_one_condition_character")
      .on(t.targetCharacterId, t.condition)
      .where(sql`kind = 'condition' and ended_at is null`),
  ],
);

/**
 * Effect preset (effect-modifiers, `effect-preset`, data model §23): a campaign preset
 * (`characterId` null; `key` set = customises that built-in, unique per campaign) or a
 * character preset (toggle; `ownerPlayerId` copies the character's owner, FR-MOD-07).
 * `modifiers` is a JSON leaf (Modifier[] 1–6, zod). Caps (40 campaign, 6 per character) are
 * checked by the commands. `usesFeatureId` is a soft id of a sheet `features` row (tier 3).
 */
export const effectPreset = sqliteTable(
  "effect_preset",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    key: text("key"),
    characterId: text("character_id").references((): AnySQLiteColumn => entity.id, {
      onDelete: "cascade",
    }),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
    name: text("name").notNull(),
    modifiers: text("modifiers", { mode: "json" }).$type<Modifier[]>().notNull(),
    durationRounds: integer("duration_rounds"),
    concentration: integer("concentration", { mode: "boolean" }).notNull().default(false),
    /** Character presets: the effect the last toggle-on made (toggle state, FR-MOD-11). */
    activeEffectId: text("active_effect_id").references((): AnySQLiteColumn => effect.id, {
      onDelete: "set null",
    }),
    usesFeatureId: text("uses_feature_id"),
    /** FR-MOD-36 (R5): the built-in key "Start from" copied (soft), else null. */
    originKey: text("origin_key"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("effect_preset_seq").on(t.seq),
    index("effect_preset_campaign").on(t.campaignId),
    index("effect_preset_character").on(t.characterId),
    // MOD §8.3: one customisation per built-in key per campaign.
    uniqueIndex("effect_preset_campaign_key").on(t.campaignId, t.key).where(sql`key is not null`),
  ],
);

/**
 * Rule trigger (effect-modifiers, `rule-trigger`, lazy record type; data model §27, ADR-0043):
 * owned by a character (`characterId`) or a monster definition (`definitionId`); exactly one is
 * set, checked by zod and the commands (a CHECK constraint makes drizzle-kit push rebuild the
 * table, as `effect`). `rule` is a JSON leaf (`TriggerRule`, MOD §8.4). Caps (6 per character,
 * 4 per definition, 40 per campaign) are command checks. `ownerPlayerId` copies the
 * character's owner (FR-MOD-47). No `createdAt` (MOD §12).
 */
export const ruleTrigger = sqliteTable(
  "rule_trigger",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    seq: integer("seq").notNull(),
    characterId: text("character_id").references((): AnySQLiteColumn => entity.id, {
      onDelete: "cascade",
    }),
    definitionId: text("definition_id").references((): AnySQLiteColumn => entity.id, {
      onDelete: "cascade",
    }),
    ownerPlayerId: text("owner_player_id").references((): AnySQLiteColumn => player.id),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    public: integer("public", { mode: "boolean" }).notNull(),
    rule: text("rule", { mode: "json" }).$type<TriggerRule>().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("rule_trigger_seq").on(t.seq),
    index("rule_trigger_character").on(t.campaignId, t.characterId),
    index("rule_trigger_definition").on(t.campaignId, t.definitionId),
  ],
);

/**
 * Trigger use (effect-modifiers, `trigger_use`; **server-only**, never a record type, never sent;
 * FR-MOD-42, ADR-0043 D3): one offered or used part of a rule trigger in an encounter. A charge
 * is free iff no `used` row has the same (trigger, owner combatant, encounter, window). `cardId`,
 * `rollId`, `targetId`, `hpChangeId`, `featureId` are soft ids.
 */
export const triggerUse = sqliteTable(
  "trigger_use",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    encounterId: text("encounter_id")
      .notNull()
      .references((): AnySQLiteColumn => encounter.id),
    seq: integer("seq").notNull(),
    triggerId: text("trigger_id")
      .notNull()
      .references((): AnySQLiteColumn => ruleTrigger.id, { onDelete: "cascade" }),
    ownerCombatantId: text("owner_combatant_id")
      .notNull()
      .references((): AnySQLiteColumn => combatant.id),
    /** `t:<round>:<turnCombatantId>` | `r:<round>` | `e` | `f` (feature), ≤ 48. */
    window: text("window").notNull(),
    state: text("state", { enum: TRIGGER_USE_STATES }).notNull(),
    cardId: text("card_id"),
    rollId: text("roll_id"),
    /** Offer: index in the card's `damage.triggers`. */
    part: integer("part"),
    targetId: text("target_id"),
    hpChangeId: text("hp_change_id"),
    value: integer("value"),
    multiplier: text("multiplier"),
    forced: integer("forced", { mode: "boolean" }).notNull().default(false),
    featureId: text("feature_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("trigger_use_seq").on(t.seq),
    index("trigger_use_charge").on(
      t.triggerId,
      t.ownerCombatantId,
      t.encounterId,
      t.window,
      t.state,
    ),
    index("trigger_use_card").on(t.cardId),
    index("trigger_use_hp_change").on(t.hpChangeId),
  ],
);

/** CON-20: `seq` values for Combat inserts, computed by the DB inside the insert's transaction. */
export const notificationSeqNext = sql<number>`(select coalesce(max(${notification.seq}), 0) + 1 from ${notification})`;
export const encounterSeqNext = sql<number>`(select coalesce(max(${encounter.seq}), 0) + 1 from ${encounter})`;
export const encounterEntrySeqNext = sql<number>`(select coalesce(max(${encounterEntry.seq}), 0) + 1 from ${encounterEntry})`;
export const combatantSeqNext = sql<number>`(select coalesce(max(${combatant.seq}), 0) + 1 from ${combatant})`;
export const hpChangeSeqNext = sql<number>`(select coalesce(max(${hpChange.seq}), 0) + 1 from ${hpChange})`;
export const effectSeqNext = sql<number>`(select coalesce(max(${effect.seq}), 0) + 1 from ${effect})`;
export const effectPresetSeqNext = sql<number>`(select coalesce(max(${effectPreset.seq}), 0) + 1 from ${effectPreset})`;
export const lootEntrySeqNext = sql<number>`(select coalesce(max(${lootEntry.seq}), 0) + 1 from ${lootEntry})`;
export const ruleTriggerSeqNext = sql<number>`(select coalesce(max(${ruleTrigger.seq}), 0) + 1 from ${ruleTrigger})`;
export const triggerUseSeqNext = sql<number>`(select coalesce(max(${triggerUse.seq}), 0) + 1 from ${triggerUse})`;

// ---------------------------------------------------------------------------------------------
// Fog of war (FOG §8, data model §24; fix/fog-core). fog-of-war writes the rows. Both cascade
// with their scene (FR-FOG-23). `token.fogged` above is the subject copy (ADR-0039).
// ---------------------------------------------------------------------------------------------

/** Fog mask of a scene (FR-FOG-01–04): no row = every cell clear. Wire `id` = `sceneId`. */
export const sceneFog = sqliteTable(
  "scene_fog",
  {
    sceneId: text("scene_id")
      .primaryKey()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    fill: text("fill", { enum: FOG_FILLS }).notNull(),
    col0: integer("col0").notNull(),
    row0: integer("row0").notNull(),
    cols: integer("cols").notNull(),
    rows: integer("rows").notNull(),
    /** Run-length mask over the box (FR-FOG-04), ≤ 2,000 runs. */
    runs: text("runs").notNull(),
    /** FR-FOG-26 / -27: fog shapes painted over the base mask, ≤ 100 (JSON leaf). */
    shapes: text("shapes", { mode: "json" }).$type<FogLayerShape[]>().notNull().default([]),
    /** FR-FOG-28 / -44: magical darkness, ≤ 20, each with its server-only `seenBy` (JSON leaf). */
    darkness: text("darkness", { mode: "json" }).$type<DarknessRow[]>().notNull().default([]),
    /** FR-FOG-29: explored memory on / off. */
    explored: integer("explored", { mode: "boolean" }).notNull().default(false),
    /** FR-FOG-38: + 1 per write (vision cache key). Server only. */
    rev: integer("rev").notNull().default(0),
    /** FR-FOG-35: re-derive on activation (senses edit / player added elsewhere). Server only. */
    visionStale: integer("vision_stale", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("scene_fog_campaign").on(t.campaignId)],
);

/** Fog undo stack (FR-FOG-07): ≤ 20 per scene, LIFO by `seq`; `prev*` = the mask before. */
export const sceneFogEdit = sqliteTable(
  "scene_fog_edit",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    sceneId: text("scene_id")
      .notNull()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: FOG_EDIT_KINDS }).notNull(),
    prevFill: text("prev_fill", { enum: FOG_FILLS }).notNull(),
    prevCol0: integer("prev_col0").notNull(),
    prevRow0: integer("prev_row0").notNull(),
    prevCols: integer("prev_cols").notNull(),
    prevRows: integer("prev_rows").notNull(),
    prevRuns: text("prev_runs").notNull(),
    /** FR-FOG-07: shapes / darkness before the edit; null on pre-v2 rows. */
    prevShapes: text("prev_shapes", { mode: "json" }).$type<FogLayerShape[]>(),
    prevDarkness: text("prev_darkness", { mode: "json" }).$type<DarknessRow[]>(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("scene_fog_edit_seq").on(t.seq),
    index("scene_fog_edit_scene").on(t.sceneId, t.seq),
    index("scene_fog_edit_campaign").on(t.campaignId),
  ],
);

/** CON-20: `seq` for undo entries, computed by the DB inside the insert's transaction. */
export const sceneFogEditSeqNext = sql<number>`(select coalesce(max(${sceneFogEdit.seq}), 0) + 1 from ${sceneFogEdit})`;

/**
 * Explored memory (FR-FOG-37): one row per (scene, player), cells as box + runs (FR-FOG-04
 * codec), never shrinks. Wire id `sceneId:playerId`. Cascades with its scene and its player.
 */
export const fogExplored = sqliteTable(
  "fog_explored",
  {
    sceneId: text("scene_id")
      .notNull()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references((): AnySQLiteColumn => player.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    col0: integer("col0").notNull(),
    row0: integer("row0").notNull(),
    cols: integer("cols").notNull(),
    rows: integer("rows").notNull(),
    runs: text("runs").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sceneId, t.playerId] }),
    index("fog_explored_campaign").on(t.campaignId),
    index("fog_explored_player").on(t.playerId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Scene tools (SCN §8, data model §25; fix/scn-core). scene-tools writes the rows. Every scene
// table cascades with its scene. `fogged` on prop / template is fog's server copy (ADR-0039),
// written through `deriveSceneObject`; never in an intent.
// ---------------------------------------------------------------------------------------------

/** Walls and doors of a scene (FR-SCN-07): one row per scene, created on the first edit. */
export const sceneStructure = sqliteTable(
  "scene_structure",
  {
    sceneId: text("scene_id")
      .primaryKey()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    /** +1 per edit (concurrent DM tabs, SCN §11). */
    rev: integer("rev").notNull(),
    /** Next segment `n`; unique per scene. */
    nextN: integer("next_n").notNull(),
    /** JSON leaf `[n, x1, y1, x2, y2][]`. */
    walls: text("walls", { mode: "json" }).$type<Wall[]>().notNull(),
    /** JSON leaf `[n, x1, y1, x2, y2, state, f][]`. */
    doors: text("doors", { mode: "json" }).$type<Door[]>().notNull(),
    /** FR-SCN-36 (sprint 3): `{<n>: playerId[]}`, FOG-written; null = pre-v2. Never on a wire. */
    doorSeen: text("door_seen", { mode: "json" }).$type<DoorSeen>(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("scene_structure_campaign").on(t.campaignId)],
);

/** DM-placed image on the objects layer (FR-SCN-16–19); ≤ 200 per scene, 2,000 per campaign. */
export const prop = sqliteTable(
  "prop",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    sceneId: text("scene_id")
      .notNull()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** Asset reference (FR-ASSET-15). */
    assetId: text("asset_id")
      .notNull()
      .references((): AnySQLiteColumn => asset.id),
    col: integer("col").notNull(),
    row: integer("row").notNull(),
    w: integer("w").notNull(),
    h: integer("h").notNull(),
    rotation: integer("rotation").notNull().default(0),
    z: integer("z").notNull().default(0),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    /** Server copy: seen by no player (FR-FOG-10, FR-SCN-35); wire only when true. */
    fogged: integer("fogged", { mode: "boolean" }).notNull().default(false),
    /** Server copy (FR-FOG-10): player ids who see it; null = pre-v2. Never on a wire. */
    seenBy: text("seen_by", { mode: "json" }).$type<string[]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("prop_seq").on(t.seq),
    index("prop_scene").on(t.sceneId),
    index("prop_campaign").on(t.campaignId),
  ],
);

/** Kept AoE template (FR-SCN-20–27); ≤ 20 per scene. Ephemeral ones are signals only. */
export const aoeTemplate = sqliteTable(
  "aoe_template",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references((): AnySQLiteColumn => campaign.id),
    sceneId: text("scene_id")
      .notNull()
      .references((): AnySQLiteColumn => scene.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    shape: text("shape", { enum: TEMPLATE_SHAPES }).notNull(),
    /** Origin vertex. */
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    size: integer("size").notNull(),
    /** Line only, else null. */
    width: integer("width"),
    angle: integer("angle").notNull(),
    label: text("label").notNull().default(""),
    /** Null = DM-placed (fog subject); else the placing player (FR-SCN-25, -27). */
    placedByPlayerId: text("placed_by_player_id").references((): AnySQLiteColumn => player.id),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    fogged: integer("fogged", { mode: "boolean" }).notNull().default(false),
    /** Server copy (FR-FOG-10): player ids who see it; null = pre-v2. Never on a wire. */
    seenBy: text("seen_by", { mode: "json" }).$type<string[]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("aoe_template_seq").on(t.seq),
    index("aoe_template_scene").on(t.sceneId),
    index("aoe_template_campaign").on(t.campaignId),
  ],
);

/** Campaign map settings (FR-SCN-29): no row = `5-10-5`. */
export const mapSettings = sqliteTable("map_settings", {
  campaignId: text("campaign_id")
    .primaryKey()
    .references((): AnySQLiteColumn => campaign.id),
  diagonalRule: text("diagonal_rule", { enum: DIAGONAL_RULES }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** CON-20: `seq` for props and templates, computed by the DB inside the insert's transaction. */
export const propSeqNext = sql<number>`(select coalesce(max(${prop.seq}), 0) + 1 from ${prop})`;
export const aoeTemplateSeqNext = sql<number>`(select coalesce(max(${aoeTemplate.seq}), 0) + 1 from ${aoeTemplate})`;

export const schema = {
  dbMeta,
  campaign,
  player,
  eventLog,
  syncProbe,
  asset,
  entity,
  sceneFolder,
  scene,
  token,
  roll,
  gameLogEntry,
  gameLogSettings,
  notification,
  encounter,
  encounterEntry,
  combatant,
  hpChange,
  lootEntry,
  creatureSheet,
  effect,
  effectPreset,
  ruleTrigger,
  triggerUse,
  sceneFog,
  sceneFogEdit,
  fogExplored,
  sceneStructure,
  prop,
  aoeTemplate,
  mapSettings,
};
