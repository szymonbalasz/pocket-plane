// Sprint 6 CP2 (FR-CBT-109), DM client: the Start dialog lists each joining PC's pets (ticked iff
// a token of theirs is on the scene, else under "Not on this map", unticked), previews them as the
// server binds them (their token or none, never a new one) and sends the ticked ones as `petIds`.
import { describe, expect, test } from "bun:test";
import { hpLabel, type JoinSlot, petOffers, previewJoin, startBody } from "./join-preview";

const owlbear = { id: "pet-owl", name: "Owlbear", companionOf: "ch-mira" };
const wolf = { id: "pet-wolf", name: "Wolf", companionOf: "ch-thorn" };
const drake = { id: "pet-drake", name: "Drake Companion", companionOf: "ch-brakka" };
const pets = [drake, owlbear, wolf];
const tokens = [
  {
    id: "t-owl",
    seq: 5,
    definitionId: "pet-owl",
    name: "Owlbear",
    imageAssetId: null,
    hidden: false,
  },
  {
    id: "t-wolf",
    seq: 6,
    definitionId: "pet-wolf",
    name: "Wolf",
    imageAssetId: null,
    hidden: false,
  },
];

describe("FR-CBT-109 pets join at Start (client)", () => {
  test("FR-CBT-109 pets join at Start: the joining PCs' pets in PC order, ticked iff on the map; a non-joining PC's pet not offered", () => {
    const offers = petOffers(pets, ["ch-mira", "ch-thorn"], tokens, new Map());
    expect(offers.map((o) => [o.pet.id, o.onMap, o.ticked])).toEqual([
      ["pet-owl", true, true],
      ["pet-wolf", true, true],
    ]);
    // Brakka joins with no drake token: "Not on this map", unticked; the DM may tick it.
    const withBrakka = petOffers(pets, ["ch-brakka", "ch-mira"], tokens, new Map());
    expect(withBrakka.map((o) => [o.pet.id, o.onMap, o.ticked])).toEqual([
      ["pet-drake", false, false],
      ["pet-owl", true, true],
    ]);
    const picked = petOffers(
      pets,
      ["ch-brakka", "ch-mira"],
      tokens,
      new Map([
        ["pet-drake", true],
        ["pet-owl", false],
      ]),
    );
    expect(picked.map((o) => o.ticked)).toEqual([true, false]);
  });

  test("FR-CBT-109 pets join at Start: a pet binds its token or joins token-less, never a new token; no HP mode shown", () => {
    const slot = (id: string, name: string): JoinSlot => ({
      kind: "monster",
      entityId: id,
      name,
      portraitAssetId: null,
      hpMode: "average",
      hasFormula: false,
      pet: true,
    });
    const rows = previewJoin(
      [slot("pet-owl", "Owlbear"), slot("pet-drake", "Drake Companion")],
      tokens,
      {
        createTokens: true,
        hidden: false,
        sceneTokenNames: tokens.map((t) => t.name),
      },
    );
    expect(rows.map((r) => [r.name, r.binding, r.tokenId])).toEqual([
      ["Owlbear", "token", "t-owl"],
      ["Drake Companion", "none", null],
    ]);
    expect(rows.map(hpLabel)).toEqual(["", ""]);
  });

  test("FR-CBT-109 pets join at Start: the ticked pets go in `petIds`; none → no field", () => {
    expect(startBody("e1", "s1", [], new Set(), null, ["pet-owl", "pet-wolf"])).toEqual({
      encounterId: "e1",
      sceneId: "s1",
      petIds: ["pet-owl", "pet-wolf"],
    });
    expect(startBody("e1", "s1", [], new Set(), null, [])).toEqual({
      encounterId: "e1",
      sceneId: "s1",
    });
  });
});
