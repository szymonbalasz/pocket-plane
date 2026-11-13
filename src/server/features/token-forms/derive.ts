// Token forms (FORM §6, ADR-0081): the shown form and the one writer of the token copies.
// `shownFormOf` reads the character's active effects (not `activeEffectId`, so write order inside a
// command doesn't matter, FR-FORM-05); `rederiveForms` brings every token of the character, on every
// scene, to the shown form's image and runs the token-changed hooks for each token it changed, so
// mirrors and combatant copies follow (FR-FORM-06, -08, -09). Writes through `env.tx` only, emits
// nothing; the caller lists the rows in its event. No top-level use of imports: combat-extras'
// `effect-hooks.ts` imports this module through `effect-hook.ts`.
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import type { TokenForm } from "@shared/token-forms/schemas";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { effect, effectPreset, entity, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readToken } from "../scenes-map/rows";
import { runTokenChangedHooks } from "../scenes-map/token-hooks";

type Env = Pick<CommandEnv, "tx" | "ctx" | "actor">;

/** FR-FORM-05: the form a character's tokens show; null = Base (also: not a character). */
export function shownFormOf(tx: Pick<Tx, "select">, characterId: string): TokenForm | null {
  const row = tx
    .select({ kind: entity.kind, tokenForms: entity.tokenForms, formId: entity.formId })
    .from(entity)
    .where(eq(entity.id, characterId))
    .get();
  if (row?.kind !== "character" || row.tokenForms.length === 0) return null;
  const byId = new Map(row.tokenForms.map((f) => [f.id, f]));
  const linked = tx
    .select({ id: effectPreset.id, formId: effectPreset.formId })
    .from(effectPreset)
    .where(and(eq(effectPreset.characterId, characterId), isNotNull(effectPreset.formId)))
    .all()
    .filter((p) => p.formId !== null && byId.has(p.formId));
  if (linked.length > 0) {
    const formOf = new Map(linked.map((p) => [p.id, p.formId as string]));
    const active = tx
      .select({ presetKey: effect.presetKey })
      .from(effect)
      .where(
        and(
          eq(effect.targetCharacterId, characterId),
          isNull(effect.endedAt),
          inArray(effect.presetKey, [...formOf.keys()]),
        ),
      )
      .orderBy(desc(effect.createdAt), desc(effect.seq))
      .all();
    for (const e of active) {
      const f = e.presetKey ? byId.get(formOf.get(e.presetKey) ?? "") : undefined;
      if (f) return f;
    }
  }
  return row.formId ? (byId.get(row.formId) ?? null) : null;
}

/** FR-FORM-07: the copy a new token of this definition gets (null for non-characters). */
export const formImageFor = (tx: Pick<Tx, "select">, characterId: string | null): string | null =>
  characterId ? (shownFormOf(tx, characterId)?.imageAssetId ?? null) : null;

const tokenChange = (before: TokenRecord, after: TokenRecord): RecordChange => ({
  type: TOKEN_TYPE,
  id: after.id,
  before,
  after,
});

/**
 * FR-FORM-06: every token of each character gets the shown form's image (null = Base); rows only
 * where the copy changes, then the token-changed hooks for each (mirrors, Initiative rows).
 */
export function rederiveForms(env: Env, characterIds: readonly string[]): RecordChange[] {
  const out: RecordChange[] = [];
  for (const characterId of new Set(characterIds)) {
    const image = formImageFor(env.tx, characterId);
    const ids = env.tx
      .select({ id: token.id, copy: token.formImageAssetId })
      .from(token)
      .where(eq(token.characterId, characterId))
      .orderBy(asc(token.seq))
      .all()
      .filter((t) => t.copy !== image)
      .map((t) => t.id);
    for (const id of ids) {
      const before = readToken(env.tx, id);
      env.tx
        .update(token)
        .set({ formImageAssetId: image, updatedAt: env.ctx.clock.iso() })
        .where(eq(token.id, id))
        .run();
      const after = readToken(env.tx, id);
      out.push(tokenChange(before, after), ...runTokenChangedHooks(env, before, after));
    }
  }
  return out;
}
