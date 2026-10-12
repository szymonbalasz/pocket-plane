// Record types `game-log-entry` (FR-DICE-15, FR-DICE-17) and `game-log-settings` (FR-DICE-16).
import {
  GameLogEntryRecord as EntrySchema,
  GAME_LOG_ENTRY_TYPE,
  GAME_LOG_SETTINGS_TYPE,
  GAME_LOG_WINDOW,
  type GameLogEntryRecord,
  type GameLogSettingsRecord,
  type RedactedGameLogEntry,
  GameLogSettingsRecord as SettingsSchema,
} from "@shared/dice-roll-log/schemas";
import { asc, eq } from "drizzle-orm";
import { gameLogEntry } from "../../db/schema";
import { defineRecordType, type Visibility } from "../../ws/records";
import { toEntryRecord } from "./game-log";
import { readSettings } from "./settings";

/** FR-DICE-15: player sees public entries redacted; hidden ones not at all. */
export const entryVisibility = (r: GameLogEntryRecord): Visibility =>
  r.public ? "redacted" : "hidden";

export function redactEntry(r: GameLogEntryRecord): RedactedGameLogEntry {
  const { dmPayload: _dm, ...rest } = r;
  return rest;
}

export const gameLogEntryType = defineRecordType<GameLogEntryRecord>({
  type: GAME_LOG_ENTRY_TYPE,
  scope: "campaign",
  schema: EntrySchema,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: entryVisibility,
  redact: redactEntry,
  // The whole log, oldest first; the registry cuts the newest 100 before the filter (ADR-0029).
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.campaignId, v.campaignId))
      .orderBy(asc(gameLogEntry.n))
      .all()
      .map(toEntryRecord),
  window: { orderBy: "n", size: GAME_LOG_WINDOW },
});

export const gameLogSettingsType = defineRecordType<GameLogSettingsRecord>({
  type: GAME_LOG_SETTINGS_TYPE,
  scope: "campaign",
  audience: "dm",
  schema: SettingsSchema,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  snapshot: ({ db }, v) => [readSettings(db, v.campaignId)],
});
