// FR-FORM-15: the player token menu offers Form ▸ only on a token of a character the player holds
// in full (their own) that has forms; the store reaches `available` through `playerMenuFor`.
import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import type { PlayerTokenRecord } from "@shared/scenes-map/schemas";
import { hasForms } from "@ui/features/token-forms/forms";
import { playerMenuFor } from "../scenes-map/token-menu";

const raging = { id: "f-rage", name: "Raging", imageAssetId: "a-rage" };
const mira = { id: "mira", kind: "character", tokenForms: [raging], formId: null };
const store = (character: Record<string, unknown> | null): RecordStore =>
  ({
    you: { campaignId: "c", role: "player", playerId: "p1" },
    seq: 0,
    records: character ? { entity: { mira: character } } : {},
  }) as unknown as RecordStore;

describe("FR-FORM-15 player token menu", () => {
  test("FR-FORM-15 player menu: Form only on a token of a held character with forms", () => {
    const tok = { id: "t", characterId: "mira" } as PlayerTokenRecord;
    const ids = (s?: RecordStore, t = tok) => playerMenuFor(t, undefined, s).map((e) => e.id);
    expect(ids(store(mira))).toContain("forms.form");
    expect(ids(store({ ...mira, tokenForms: [] }))).not.toContain("forms.form");
    expect(ids(store(null))).not.toContain("forms.form");
    expect(ids(undefined)).not.toContain("forms.form");
    expect(ids(store(mira), { ...tok, characterId: null })).not.toContain("forms.form");
    expect(hasForms(store(mira), "mira")).toBe(true);
  });
});
