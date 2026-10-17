// FR-FOG-48 (sprint 4, seams S6, OQ-FOG-57): fog's line in combat-extras' `effectHooks` registry
// (ADR-0049 D2). An effect write on a character (in or out of combat) re-derives, in the causing
// transaction, the active scene if it holds a source token of that character (a `blinded` start,
// end or restore changes the sight's cache key, FR-FOG-38, so only a real change is listed); the
// character's other source scenes are marked `visionStale` (re-derived on activation). Monsters are
// never sources: a combatant target changes nothing here. Same shape as the senses line
// (`lifecycle.ts`). No top-level use of imports: `effect-hooks.ts` imports this module.
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { token } from "../../db/schema";
import type { EffectHook } from "../combat-extras/effect-hooks";
import { markScenesStale, mergeChanges, rederiveScene } from "./rederive";

export const fogBlindedEffectHook: EffectHook = {
  id: "fog-of-war.blinded",
  effectsChanged(env, { creatures }) {
    const chars = creatures.flatMap((c) => ("characterId" in c ? [c.characterId] : []));
    if (chars.length === 0) return [];
    const rows = env.tx
      .select({ sceneId: token.sceneId, campaignId: token.campaignId, owner: token.ownerPlayerId })
      .from(token)
      .where(
        and(
          inArray(token.definitionId, chars),
          isNotNull(token.ownerPlayerId),
          eq(token.hidden, false),
        ),
      )
      .orderBy(asc(token.seq))
      .all();
    const first = rows[0];
    if (!first) return [];
    const scenes = [...new Set(rows.map((r) => r.sceneId))];
    const players = [...new Set(rows.map((r) => r.owner as string))];
    return mergeChanges(
      markScenesStale(env, first.campaignId, scenes).flatMap((id) =>
        rederiveScene(env, id, { players }),
      ),
    );
  },
};
