// `char.rest` (FR-CHARX-121–124, DM): a short or long rest for 1–20 characters in one
// transaction. Per character: `restOutcome` on its `creature-sheet` counters and its `entity` play
// columns (HP, temp HP, death saves: the one place they live, in or out of combat), a `char.rest`
// log line for the DM and the owner, and one `CharacterRested`. Nothing to change → no write, no
// line, no event. Conditions and effects are not touched; combat doesn't block a rest.

import { restOutcome } from "@shared/character-sheet/rest";
import { LOG_KIND_CHAR_REST } from "@shared/character-sheet/rest-kind";
import { CHARX_INTENTS, CharRestIntent, type CharRestResult } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { CharacterRested } from "@shared/events/character-sheet";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { entity } from "../../db/schema";
import { gameLog } from "../dice-roll-log";
import { getRow, toEntityRecord } from "../entities/rows";
import { counterCharacter } from "./access";
import { mergeChanges, sameValue, sheetOrNew, writeSheet } from "./sheet-rows";

export const charRest = defineCommand({
  name: CHARX_INTENTS.rest,
  input: CharRestIntent,
  execute({ characterIds, kind }, env): CharRestResult {
    // Every target checked before anything is written (a monster → `invalid`, as useResource).
    const targets = characterIds.map((id) => counterCharacter(env, id));
    const rested: string[] = [];
    for (const c of targets) {
      const { before: row, sheet } = sheetOrNew(env, c);
      const now = {
        hpCurrent: c.hpCurrent,
        tempHp: c.tempHp,
        deathSuccesses: c.deathSuccesses,
        deathFailures: c.deathFailures,
      };
      const counters = {
        slotsUsed: sheet.slotsUsed,
        hitDiceUsed: sheet.hitDiceUsed,
        features: sheet.features,
      };
      const out = restOutcome(kind, { ...now, sheet: counters }, c.statBlock);
      const { sheet: nextCounters, ...next } = out;
      const sheetChange = sameValue(counters, nextCounters)
        ? null
        : writeSheet(env, row, { ...sheet, ...nextCounters });
      let entityChange = null;
      if (!sameValue(now, next)) {
        env.tx
          .update(entity)
          .set({ ...next, updatedAt: env.ctx.clock.iso() })
          .where(eq(entity.id, c.id))
          .run();
        const after = toEntityRecord(
          getRow(env.tx, c.id) as NonNullable<ReturnType<typeof getRow>>,
        );
        entityChange = { type: ENTITY_TYPE, id: c.id, before: c, after };
      }
      if (!sheetChange && !entityChange) continue;
      // FR-CHARX-124: the owner hears of their own rest; an unowned character → the DM only.
      const owner = c.ownerPlayerId || null;
      const line = gameLog.append(env, {
        kind: LOG_KIND_CHAR_REST,
        category: "other",
        actorName: c.name,
        payload: { characterId: c.id, kind },
        rollIds: [],
        ...(owner ? { audiencePlayerId: owner } : { forcePrivate: true }),
      });
      env.emit({
        type: CharacterRested.type,
        campaignId: c.campaignId,
        payload: { characterId: c.id, kind, entryId: line.id },
        changes: mergeChanges([sheetChange, entityChange, line]),
      });
      rested.push(c.id);
    }
    return { rested };
  },
});
