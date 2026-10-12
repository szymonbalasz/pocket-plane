// Public log settings (FR-DICE-12, FR-DICE-16): one row per campaign, no row = all hidden.

import {
  defaultSettings,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  SETTINGS_COLUMN,
  SetCategoryPublicIntent,
} from "@shared/dice-roll-log/schemas";
import { PublicLogCategorySet } from "@shared/events/dice-roll-log";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { gameLogSettings } from "../../db/schema";
import type { Actor } from "../../events/types";

export const SET_CATEGORY_PUBLIC = "dice.setCategoryPublic";

export function campaignOf(actor: Actor): string {
  if (!actor.campaignId) throw conflict("No active campaign");
  return actor.campaignId;
}

/** The campaign's settings row, or the all-hidden defaults with `id = campaignId`. */
export function readSettings(tx: Pick<Tx, "select">, campaignId: string): GameLogSettingsRecord {
  const row = tx
    .select()
    .from(gameLogSettings)
    .where(eq(gameLogSettings.campaignId, campaignId))
    .get();
  return row ? { ...row } : defaultSettings(campaignId);
}

/** `dice.setCategoryPublic` (DM): same value → no-op, no event. Never retroactive. */
export const setCategoryPublic = defineCommand({
  name: SET_CATEGORY_PUBLIC,
  input: SetCategoryPublicIntent,
  execute(input, env): void {
    const cid = campaignOf(env.actor);
    const before = readSettings(env.tx, cid);
    const column = SETTINGS_COLUMN[input.category];
    if (before[column] === input.public) return;
    env.tx
      .insert(gameLogSettings)
      .values({ id: cid, campaignId: cid, [column]: input.public })
      .onConflictDoUpdate({ target: gameLogSettings.id, set: { [column]: input.public } })
      .run();
    const after = readSettings(env.tx, cid);
    env.emit({
      type: PublicLogCategorySet.type,
      campaignId: cid,
      payload: { category: input.category, public: input.public },
      changes: [{ type: GAME_LOG_SETTINGS_TYPE, id: cid, before, after }],
    });
  },
});
