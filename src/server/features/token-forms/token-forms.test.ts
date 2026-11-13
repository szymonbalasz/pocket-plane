// Token forms (FORM §13, ADR-0081): forms on Mira, a Rage-like preset linked to a form, the shown
// form on every token of hers, her Initiative row and her mirror, and every way the form ends.
// CBTX's ambush (in combat, round 1), Mira owned by player 1.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { FORM_INTENTS, type TokenFormInput } from "@shared/token-forms/schemas";
import { MIR_INTENTS } from "@shared/token-mirrors/schemas";
import { asc, eq } from "drizzle-orm";
import { combatant, token, tokenMirror } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { assetUses } from "../assets-pipeline/manage";
import { startCommand } from "../combat-tracker/lifecycle";
import { modSetup } from "../effect-modifiers/testing";
import { readToken } from "../scenes-map/rows";
import { addAsset } from "../scenes-map/testing";
import { shownFormOf } from "./derive";

function setup() {
  const t = modSetup();
  for (const id of ["art-raging", "art-enlarged", "art-wild"]) addAsset(t.s, id, t.h.campaignId);
  const mira = t.miraId;
  const putForms = (forms: TokenFormInput[], actor: Actor = t.h.dm) =>
    t.run(FORM_INTENTS.put, { characterId: mira, forms }, actor);
  const choose = (formId: string | null, actor: Actor = t.h.dm) =>
    t.run(FORM_INTENTS.choose, { characterId: mira, formId }, actor);
  putForms([
    { name: "Raging", imageAssetId: "art-raging" },
    { name: "Enlarged", imageAssetId: "art-enlarged" },
  ]);
  const forms = () => t.character(mira).tokenForms;
  const formId = (name: string) => forms().find((f) => f.name === name)?.id as string;
  const makePreset = (name: string, form: string | null, durationRounds: number | null = 10) =>
    t.put({
      characterId: mira,
      key: null,
      name,
      modifiers: [{ kind: "flat", on: { roll: "damage" }, value: 2 }],
      durationRounds,
      concentration: false,
      note: "",
      formId: form,
    });
  const miraTokens = () =>
    t.s.db
      .select({ id: token.id, image: token.imageAssetId, form: token.formImageAssetId })
      .from(token)
      .where(eq(token.characterId, mira))
      .orderBy(asc(token.seq))
      .all();
  const shown = () => [...new Set(miraTokens().map((x) => x.form))];
  const initiativeArt = () =>
    t.s.db
      .select({ image: combatant.imageAssetId })
      .from(combatant)
      .where(eq(combatant.tokenId, t.tokens.mira))
      .get()?.image;
  return {
    ...t,
    mira,
    putForms,
    choose,
    forms,
    formId,
    makePreset,
    miraTokens,
    shown,
    initiativeArt,
  };
}

describe("FR-FORM token forms", () => {
  test("FR-FORM-01 FR-FORM-02 forms: DM only, ids kept, assets checked, caps and names", () => {
    const t = setup();
    const raging = t.formId("Raging");
    t.putForms([
      { id: raging, name: "Raging", imageAssetId: "art-wild" },
      { name: "Wild", imageAssetId: "art-wild" },
    ]);
    expect(t.forms().map((f) => [f.id === raging, f.name, f.imageAssetId])).toEqual([
      [true, "Raging", "art-wild"],
      [false, "Wild", "art-wild"],
    ]);
    expect(t.err(() => t.putForms([], t.p1)).code).toBe("forbidden");
    expect(
      t.err(() => t.putForms([{ id: "nope", name: "X", imageAssetId: "art-wild" }])).code,
    ).toBe("invalid");
    expect(t.err(() => t.putForms([{ name: "X", imageAssetId: "art-other" }])).code).toBe(
      "not_found",
    );
    const seven = Array.from({ length: 7 }, (_, i) => ({
      name: `F${i}`,
      imageAssetId: "art-wild",
    }));
    expect(t.err(() => t.putForms(seven)).code).toBe("invalid");
    expect(
      t.err(() =>
        t.putForms([
          { name: "Same", imageAssetId: "art-wild" },
          { name: "same", imageAssetId: "art-wild" },
        ]),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() => t.run(FORM_INTENTS.put, { characterId: t.h.goblinId, forms: [] })).code,
    ).toBe("not_found");
  });

  test("FR-FORM-03 FR-FORM-06 FR-FORM-09 choose: DM and owner (locked too), every token, Initiative row", () => {
    const t = setup();
    t.run(MAP_INTENTS.placeToken, { sceneId: t.sceneId, definitionId: t.mira, col: 4, row: 4 });
    t.run(CHARX_INTENTS.setLock, { characterId: t.mira, locked: true });
    t.choose(t.formId("Enlarged"), t.p1);
    expect(t.miraTokens()).toHaveLength(2);
    expect(t.shown()).toEqual(["art-enlarged"]);
    expect(t.initiativeArt()).toBe("art-enlarged");
    // Own art untouched (ADR-0081).
    expect(t.miraTokens().every((x) => x.image === "art-mira")).toBe(true);
    expect(t.err(() => t.choose(null, t.p2)).code).toBe("forbidden");
    expect(t.err(() => t.choose("nope")).code).toBe("invalid");
    const n = t.events.length;
    t.choose(t.formId("Enlarged"));
    expect(t.events.length).toBe(n);
    t.choose(null);
    expect(t.shown()).toEqual([null]);
    expect(t.initiativeArt()).toBe("art-mira");
  });

  test("FR-FORM-04 FR-FORM-05 preset link: on shows it, off goes back to the hand-picked form", () => {
    const t = setup();
    const rage = t.makePreset("Rage", t.formId("Raging"));
    t.choose(t.formId("Enlarged"));
    t.toggle(t.mira, rage, true, t.p1);
    expect(t.shown()).toEqual(["art-raging"]);
    expect(t.initiativeArt()).toBe("art-raging");
    t.toggle(t.mira, rage, false, t.p1);
    expect(t.shown()).toEqual(["art-enlarged"]);
    t.choose(null);
    t.toggle(t.mira, rage, true, t.p1);
    t.toggle(t.mira, rage, false, t.p1);
    expect(t.shown()).toEqual([null]);
    // A form of another character, or on a campaign preset → invalid.
    expect(t.err(() => t.makePreset("Bad", "nope")).code).toBe("invalid");
    expect(
      t.err(() =>
        t.put({
          characterId: null,
          key: null,
          name: "Camp",
          modifiers: [{ kind: "flat", on: { roll: "damage" }, value: 1 }],
          durationRounds: null,
          concentration: false,
          note: "",
          formId: t.formId("Raging"),
        } as never),
      ).code,
    ).toBe("invalid");
  });

  test("FR-FORM-05 two preset forms: the later one shows; ending it shows the other", () => {
    const t = setup();
    const rage = t.makePreset("Rage", t.formId("Raging"));
    const big = t.makePreset("Enlarge", t.formId("Enlarged"));
    t.toggle(t.mira, rage, true);
    t.toggle(t.mira, big, true);
    expect(t.shown()).toEqual(["art-enlarged"]);
    t.toggle(t.mira, big, false);
    expect(t.shown()).toEqual(["art-raging"]);
  });

  test("FR-FORM-06 expiry ends the form (effect hook), in combat", () => {
    const t = setup();
    const rage = t.makePreset("Short rage", t.formId("Raging"), 1);
    t.toggle(t.mira, rage, true);
    expect(t.shown()).toEqual(["art-raging"]);
    t.nextTo("Mira", 2);
    expect(t.active().some((e) => e.presetKey === rage)).toBe(false);
    expect(t.shown()).toEqual([null]);
    expect(t.initiativeArt()).toBe("art-mira");
  });

  test("FR-FORM-06 FR-FORM-02 delete the preset, remove the form, unlink: the tokens fall back", () => {
    const t = setup();
    const rage = t.makePreset("Rage", t.formId("Raging"));
    t.toggle(t.mira, rage, true);
    t.run("mod.deletePreset", { presetId: rage });
    expect(t.shown()).toEqual([null]);

    const rage2 = t.makePreset("Rage 2", t.formId("Raging"));
    t.choose(t.formId("Raging"));
    t.toggle(t.mira, rage2, true);
    const enlarged = t.formId("Enlarged");
    t.putForms([{ id: enlarged, name: "Enlarged", imageAssetId: "art-enlarged" }]);
    expect(t.character(t.mira).formId).toBeNull();
    expect(t.preset(rage2)?.formId ?? null).toBeNull();
    expect(t.shown()).toEqual([null]);
    expect(shownFormOf(t.s.db, t.mira)).toBeNull();
  });

  test("FR-FORM-07 FR-FORM-08 placed and duplicated while raging; the mirror follows", () => {
    const t = setup();
    const m = t.run<{ mirrorId: string }>(MIR_INTENTS.create, {
      tokenId: t.tokens.mira,
      col: 6,
      row: 6,
    });
    const mirrorArt = () =>
      t.s.db
        .select({ image: tokenMirror.imageAssetId })
        .from(tokenMirror)
        .where(eq(tokenMirror.id, m.mirrorId))
        .get()?.image;
    expect(mirrorArt()).toBe("art-mira");
    t.choose(t.formId("Raging"));
    expect(mirrorArt()).toBe("art-raging");
    t.run(MAP_INTENTS.placeToken, { sceneId: t.sceneId, definitionId: t.mira, col: 4, row: 4 });
    t.run(MAP_INTENTS.duplicateToken, { tokenId: t.tokens.mira });
    expect(t.miraTokens()).toHaveLength(3);
    expect(t.shown()).toEqual(["art-raging"]);
    t.choose(null);
    expect(t.shown()).toEqual([null]);
    expect(mirrorArt()).toBe("art-mira");
  });

  test("FR-FORM-10 a token with custom art shows the form too, and its own art again on Base", () => {
    const t = setup();
    t.run(MAP_INTENTS.updateToken, { tokenId: t.tokens.mira, imageAssetId: "art-wild" });
    t.choose(t.formId("Raging"));
    expect(t.miraTokens()[0]).toMatchObject({ image: "art-wild", form: "art-raging" });
    t.choose(null);
    expect(t.miraTokens()[0]).toMatchObject({ image: "art-wild", form: null });
  });

  test("FR-FORM-11 a form's image is in use", () => {
    const t = setup();
    expect(assetUses(t.s.db, "art-enlarged")).toEqual([{ kind: "token form", name: "Mira" }]);
  });

  test("FR-FORM-12 the token copy rides the wire only when set; players get it, never the forms", () => {
    const t = setup();
    expect(t.miraTokens()[0]?.form).toBeNull();
    t.choose(t.formId("Raging"));
    const ev = t.events.at(-1);
    expect(ev?.event.type).toBe("TokenFormChosen");
    const tok = ev?.event.changes.find((c) => c.type === "token" && c.id === t.tokens.mira);
    expect(tok?.after).toMatchObject({ formImageAssetId: "art-raging" });
    expect(tok?.before).not.toHaveProperty("formImageAssetId");
  });

  test("FR-FORM-06 Prev restores an expired Rage, and its form with it", () => {
    const t = setup();
    const rage = t.makePreset("Short rage", t.formId("Raging"), 1);
    t.toggle(t.mira, rage, true);
    t.nextTo("Mira", 2);
    expect(t.shown()).toEqual([null]);
    t.step("prev");
    expect(t.active().some((e) => e.presetKey === rage)).toBe(true);
    expect(t.shown()).toEqual(["art-raging"]);
    expect(t.initiativeArt()).toBe("art-raging");
  });

  test("FR-FORM-06 FR-FORM-09 encounter End keeps tokens in step with Rage; a new fight binds the form art", () => {
    const t = setup();
    const rage = t.makePreset("Rage", t.formId("Raging"));
    t.toggle(t.mira, rage, true);
    t.endEncounter();
    const on = t.active().some((e) => e.presetKey === rage);
    expect(t.shown()).toEqual([on ? "art-raging" : null]);
    t.choose(t.formId("Enlarged"));
    if (on) t.toggle(t.mira, rage, false);
    expect(t.shown()).toEqual(["art-enlarged"]);
    const enc = t.createAmbush();
    t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
    const bound = t.combatants(enc.id).find((c) => c.tokenId === t.tokens.mira);
    expect(bound?.imageAssetId).toBe("art-enlarged");
  });

  test("FR-FORM-12 players receive the token's form copy (not on Base)", () => {
    const t = setup();
    const viewer = (playerId: string): Viewer => ({
      connId: "c",
      campaignId: t.h.campaignId,
      role: "player",
      playerId,
    });
    t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
    const row = () => readToken(t.s.db, t.tokens.mira);
    expect(t.s.records.view("token", row(), viewer(t.h.p2.id)).data).not.toHaveProperty(
      "formImageAssetId",
    );
    t.choose(t.formId("Raging"));
    for (const p of [t.h.p1.id, t.h.p2.id]) {
      const view = t.s.records.view("token", row(), viewer(p));
      expect(view.vis).toBe("redacted");
      expect(view.data).toMatchObject({ formImageAssetId: "art-raging" });
    }
  });
});
