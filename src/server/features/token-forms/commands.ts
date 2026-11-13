// Token-form commands (FORM §6, §9; ADR-0081): `forms.put` (DM) and `forms.choose` (DM; owner, also
// while the sheet is locked, like `mod.toggle`). One transaction each: validate → entity write →
// preset links → token copies (+ their mirror and combatant copies) → one event. IDs and time from ctx.

import { PresetInput, type PutPresetResult } from "@shared/effect-modifiers/intents";
import { type CharacterRecord, ENTITY_TYPE } from "@shared/entities/schemas";
import { TokenFormChosen, TokenFormsSaved } from "@shared/events/token-forms";
import {
  ChooseFormInput,
  FORM_INTENTS,
  FORM_NAME_MAX,
  PutFormsInput,
  type TokenForm,
} from "@shared/token-forms/schemas";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { forbidden, invalid } from "../../commands/errors";
import { effectPreset, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { NOT_YOURS } from "../character-sheet/access";
import { getCharacter } from "../character-sheet/hp";
import { putPreset } from "../effect-modifiers/commands";
import { presetChange, readPreset } from "../effect-modifiers/rows";
import { getRow, toEntityRecord } from "../entities/rows";
import { rederiveForms } from "./derive";

const entityChange = (before: CharacterRecord, env: CommandEnv): RecordChange => {
  const row = getRow(env.tx, before.id);
  return { type: ENTITY_TYPE, id: before.id, before, after: row ? toEntityRecord(row) : null };
};

/** FR-FORM-02: whole replace of a character's forms (DM). */
export const putForms = defineCommand({
  name: FORM_INTENTS.put,
  input: PutFormsInput,
  roles: ["dm"],
  execute({ characterId, forms }, env): void {
    const c = getCharacter(env, characterId);
    const known = new Set(c.tokenForms.map((f) => f.id));
    const next: TokenForm[] = forms.map((f, i) => {
      if (f.id !== undefined && !known.has(f.id)) {
        throw invalid("Unknown form", [
          { path: ["forms", i, "id"], message: "Not a form of this character" },
        ]);
      }
      return {
        id: f.id ?? env.ctx.ids.next(),
        name: f.name,
        imageAssetId: requireAsset(env, f.imageAssetId).id,
      };
    });
    const unchanged = JSON.stringify(next) === JSON.stringify(c.tokenForms);
    if (unchanged) return;
    const kept = new Set(next.map((f) => f.id));
    const now = env.ctx.clock.iso();
    env.tx
      .update(entity)
      .set({
        tokenForms: next,
        // FR-FORM-02: a removed chosen form falls back to Base.
        formId: c.formId !== null && kept.has(c.formId) ? c.formId : null,
        updatedAt: now,
      })
      .where(eq(entity.id, c.id))
      .run();
    // FR-FORM-02: presets naming a removed form lose the link.
    const presetChanges: RecordChange[] = [];
    const linked = env.tx
      .select({ id: effectPreset.id, formId: effectPreset.formId })
      .from(effectPreset)
      .where(and(eq(effectPreset.characterId, c.id), isNotNull(effectPreset.formId)))
      .all();
    for (const p of linked) {
      if (p.formId !== null && kept.has(p.formId)) continue;
      const before = readPreset(env.tx, p.id);
      env.tx
        .update(effectPreset)
        .set({ formId: null, updatedAt: now })
        .where(eq(effectPreset.id, p.id))
        .run();
      presetChanges.push(presetChange(before, readPreset(env.tx, p.id)));
    }
    env.emit({
      type: TokenFormsSaved.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id },
      changes: [entityChange(c, env), ...presetChanges, ...rederiveForms(env, [c.id])],
    });
  },
});

export const PUT_PRESET_WITH_FORM = "forms.putPresetWithForm";

/**
 * Internal (fixtures; not an intent): `mod.putPreset` with `formId` = the character's form named
 * `form` (case-insensitive), since a fixture step can't read a form id (`mira-forms`). No such
 * form → `invalid`.
 */
export const putPresetWithForm = defineCommand({
  name: PUT_PRESET_WITH_FORM,
  input: z.strictObject({ preset: PresetInput, form: z.string().min(1).max(FORM_NAME_MAX) }),
  roles: ["dm"],
  execute({ preset, form }, env): PutPresetResult {
    if (preset.characterId === null) throw invalid("Token forms on character presets only");
    const name = form.trim().toLowerCase();
    const f = getCharacter(env, preset.characterId).tokenForms.find(
      (x) => x.name.toLowerCase() === name,
    );
    if (!f) throw invalid(`No token form named ${form}`);
    return putPreset.execute({ preset: { ...preset, formId: f.id } }, env);
  },
});

/** FR-FORM-03: the hand-picked form (null = Base). */
export const chooseForm = defineCommand({
  name: FORM_INTENTS.choose,
  input: ChooseFormInput,
  roles: ["dm", "player"],
  execute({ characterId, formId }, env): void {
    const c = getCharacter(env, characterId);
    if (env.actor.role === "player" && c.ownerPlayerId !== env.actor.playerId) {
      throw forbidden(NOT_YOURS);
    }
    if (formId !== null && !c.tokenForms.some((f) => f.id === formId)) {
      throw invalid("Unknown form", [
        { path: ["formId"], message: "Not a form of this character" },
      ]);
    }
    if (c.formId === formId) return;
    env.tx
      .update(entity)
      .set({ formId, updatedAt: env.ctx.clock.iso() })
      .where(eq(entity.id, c.id))
      .run();
    env.emit({
      type: TokenFormChosen.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, formId },
      changes: [entityChange(c, env), ...rederiveForms(env, [c.id])],
    });
  },
});
