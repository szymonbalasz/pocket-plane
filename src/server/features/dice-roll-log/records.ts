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
import { desc, eq } from "drizzle-orm";
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
  // The newest 100 by `n`, cut in SQL (#163: build time no longer grows with the log), oldest
  // first. The registry's cut (ADR-0029) keeps exactly these rows; the floor is the same.
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.campaignId, v.campaignId))
      .orderBy(desc(gameLogEntry.n))
      .limit(GAME_LOG_WINDOW)
      .all()
      .reverse()
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
