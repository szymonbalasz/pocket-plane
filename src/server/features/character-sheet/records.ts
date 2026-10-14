// Record type `creature-sheet` (CHARX §9, FR-CHARX-36): DM full; a player full iff the row's
// owner copy is theirs; otherwise hidden (other players' sheets, every NPC sheet).
import { CREATURE_SHEET_TYPE, CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { asc, eq, sql } from "drizzle-orm";
import { creatureSheet } from "../../db/schema";
import type { Logger } from "../../log";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { InvalidStoredSheet, toSheetRecord } from "./sheet-rows";

export function sheetVisibility(r: CreatureSheetRecord, v: Viewer): Visibility {
  return r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId ? "full" : "hidden";
}

export function creatureSheetRecordType(log: Logger) {
  return defineRecordType<CreatureSheetRecord>({
    type: CREATURE_SHEET_TYPE,
    scope: "campaign",
    schema: CreatureSheetRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: sheetVisibility,
    // The campaign's sheets (≤ PCs + custom NPCs, CHARX §12); invalid rows omitted and logged.
    snapshot: ({ db }, v) => {
      const out: CreatureSheetRecord[] = [];
      const rows = db
        .select()
        .from(creatureSheet)
        .where(eq(creatureSheet.campaignId, v.campaignId))
        .orderBy(asc(sql`rowid`))
        .all();
      for (const row of rows) {
        try {
          out.push(toSheetRecord(row));
        } catch (err) {
          if (!(err instanceof InvalidStoredSheet)) throw err;
          log.error(`character-sheet: stored sheet ${row.entityId} is invalid; omitted`);
        }
      }
      return out;
    },
  });
}
