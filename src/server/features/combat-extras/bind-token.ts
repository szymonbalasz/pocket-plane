// `cbtx.bindToken` (FR-CBTX-45; N6, N6.1): link a token dropped later to a token-less combatant,
// or `tokenId: null` to unlink a bound one, so a wrong link is fixed without Remove. Linking
// copies the token's name, image and `hidden` (FR-CBT-08 rule, OQ-CBTX-23); a `hidden` change
// reranks and rewrites the player turn and the effects' hidden copies (FR-CBTX-13). Unlinking
// keeps the copies; the token stays on the map. `movedFt` unchanged either way. DM only.
import { BindTokenInput, CBTX_INTENTS } from "@shared/combat-extras/intents";
import { CombatantBound } from "@shared/events/combat-extras";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { combatant } from "../../db/schema";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "../combat-tracker/ranks";
import {
  campaignOf,
  combatantsOf,
  getCombatant,
  readCombatant,
  readEncounter,
} from "../combat-tracker/rows";
import { getToken } from "../scenes-map/rows";
import { syncHidden } from "./rule-hooks";

export const bindToken = defineCommand({
  name: CBTX_INTENTS.bindToken,
  input: BindTokenInput,
  execute({ combatantId, tokenId }, env): void {
    const { tx } = env;
    const cid = campaignOf(env.actor);
    const c = getCombatant(tx, cid, combatantId);
    const enc = readEncounter(tx, c.encounterId);
    if (!c.active || enc.status !== "started") throw conflict(`${c.name} is not in combat`);
    const rows = combatantsOf(tx, enc.id);
    const encBefore = readEncounter(tx, enc.id);
    if (tokenId === null) {
      if (c.tokenId === null) throw conflict(`${c.name} has no token`);
      tx.update(combatant).set({ tokenId: null }).where(eq(combatant.id, c.id)).run();
    } else {
      if (c.tokenId !== null) throw invalid(`${c.name} already has a token`);
      const t = getToken(tx, cid, tokenId);
      if (t.sceneId !== enc.sceneId) throw notFound("Token not found on the encounter's scene");
      const holder = tx
        .select({ name: combatant.name })
        .from(combatant)
        .where(and(eq(combatant.tokenId, t.id), eq(combatant.active, true)))
        .get();
      if (holder) throw conflict(`${t.name} is already in combat`);
      if (t.definitionId !== c.entityId) throw invalid("Token is a different creature");
      tx.update(combatant)
        .set({ tokenId: t.id, name: t.name, imageAssetId: t.imageAssetId, hidden: t.hidden })
        .where(eq(combatant.id, c.id))
        .run();
      if (t.hidden !== c.hidden) rerank(tx, enc.id);
    }
    const encAfter = syncPlayerTurn(env, enc.id);
    env.emit({
      type: CombatantBound.type,
      campaignId: cid,
      payload: { combatantId: c.id, tokenId },
      changes: [
        ...combatantDiff(tx, rows),
        ...encounterDiff(encBefore, encAfter),
        ...syncHidden(env, [readCombatant(tx, c.id)]),
      ],
    });
  },
});
