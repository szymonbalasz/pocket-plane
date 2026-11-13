// Token forms, client logic (FORM §13 unit): which preset gives the shown form for the header line,
// new form names, the player menu's availability and the drawn art in `tokenArtOf`.
import { describe, expect, test } from "bun:test";
import type { EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenForm } from "@shared/token-forms/schemas";
import { tokenArtOf } from "../entities/art";
import { formsOf, newFormName, presetFormName, presetFormShown } from "./forms";

const raging: TokenForm = { id: "f-rage", name: "Raging", imageAssetId: "a-rage" };
const big: TokenForm = { id: "f-big", name: "Enlarged", imageAssetId: "a-big" };
const preset = (id: string, formId: string | null, activeEffectId: string | null) =>
  ({
    id,
    characterId: "mira",
    name: id,
    formId,
    activeEffectId,
  }) as unknown as EffectPresetRecord;
const fx = (id: string) => ({ id, endedAt: null });

const store = (character: Record<string, unknown> | null): RecordStore =>
  ({
    you: { campaignId: "c", role: "player", playerId: "p1" },
    seq: 0,
    records: character ? { entity: { mira: character } } : {},
  }) as unknown as RecordStore;
const mira = { id: "mira", kind: "character", tokenForms: [raging, big], formId: null };

describe("FR-FORM-14 FR-FORM-16 client logic", () => {
  test("FR-FORM-14 presetFormShown: none, one on, two on (the one a token shows), off ignored", () => {
    const forms = [raging, big];
    expect(presetFormShown(forms, [preset("Rage", "f-rage", "e1")], [], [])).toBeNull();
    expect(
      presetFormShown(forms, [preset("Rage", "f-rage", "e1")], [fx("e1")], [])?.form.name,
    ).toBe("Raging");
    const both = [preset("Rage", "f-rage", "e1"), preset("Enlarge", "f-big", "e2")];
    expect(presetFormShown(forms, both, [fx("e1"), fx("e2")], ["a-big"])?.preset.name).toBe(
      "Enlarge",
    );
    // A link to a removed form, or no link, never counts.
    expect(presetFormShown(forms, [preset("Gone", "f-x", "e1")], [fx("e1")], [])).toBeNull();
    expect(presetFormShown(forms, [preset("Plain", null, "e1")], [fx("e1")], [])).toBeNull();
  });

  test("FR-FORM-13 newFormName: image name, unique, cut to 24; Form without one", () => {
    expect(newFormName("Mira raging", [])).toBe("Mira raging");
    expect(newFormName(undefined, [])).toBe("Form");
    expect(newFormName("Raging", [raging])).toBe("Raging 2");
    expect(newFormName("x".repeat(30), [])).toHaveLength(24);
    const long = { ...raging, name: "y".repeat(24) };
    expect(newFormName("y".repeat(30), [long])).toBe(`${"y".repeat(22)} 2`);
  });

  test("FR-FORM-12 formsOf: full characters only; a redacted one has none", () => {
    expect(formsOf(mira)).toHaveLength(2);
    expect(formsOf({ id: "thorn", kind: "character", name: "Thorn" })).toEqual([]);
    expect(formsOf({ id: "g", kind: "monster" })).toEqual([]);
    expect(formsOf(undefined)).toEqual([]);
  });

  test("FR-FORM-16 presetFormName: the linked form's name, else null", () => {
    expect(presetFormName(store(mira), preset("Rage", "f-rage", null))).toBe("Raging");
    expect(presetFormName(store(mira), preset("Rage", "f-x", null))).toBeNull();
    expect(presetFormName(store(mira), preset("Rage", null, null))).toBeNull();
  });

  test("FR-FORM-08 tokenArtOf: a form copy is image art even without the token's own image", () => {
    expect(tokenArtOf({ imageAssetId: null, formImageAssetId: "a-rage", creatureType: null })).toBe(
      "image",
    );
    expect(tokenArtOf({ imageAssetId: null, creatureType: null })).toBe("initials");
  });
});
