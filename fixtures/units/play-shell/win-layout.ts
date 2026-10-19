import { createEncounter } from "@server/features/combat-tracker/encounters";
import { adaptOpen5e } from "@server/features/compendium/adapter/open5e";
import { togglePreset } from "@server/features/effect-modifiers/commands";
import { createEntity } from "@server/features/entities/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import type { ToggleInput } from "@shared/effect-modifiers/intents";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { type CreateEntityBody, ENTITY_TYPE } from "@shared/entities/schemas";
import { srdMini } from "../../srd/open5e";
import { srdMiniMonsterId } from "../compendium/srd-mini-refs";

const KEY = "win-layout";

// The SRD Ogre's creature core as the mini import writes it (FR-CMP-03); Derive copies it.
const ogre = adaptOpen5e({ monsters: srdMini.monsters }).records.find(
  (r) => r.kind === "monster" && r.sourceKey === "monster/ogre",
);
if (ogre?.kind !== "monster") throw new Error(`${KEY}: SRD mini has no Ogre`);
const ogreBlock = ogre.definition.statBlock;

const scene = (r: Refs) => r.id("battlemap", "scene");
const cryptOgre = (r: Refs) => r.id(KEY, ENTITY_TYPE);

/**
 * SHELL §13 sprint 5 `win-layout` (track W; DM steps only, FR-FIX-13), a patch on
 * `session-sim-8`: Brakka's Rage on (10 rounds) through the MOD feature toggle with the overspend
 * confirm ("Rage anyway": uses 0 / 3 → −1 / 3, as sim-8 step h), so her Initiative row carries
 * "Rage 10r" + the Divine Fury chip; a planned, unstarted "Crypt" for Goblin Ambush: "Crypt Ogre"
 * (the SRD Ogre's core, `derivedFromId` = its definition, large; visible token at (18, 6)) and the
 * SRD Goblin whose visible token "Goblin 3" sits at (8, 2) (`ent-art-tokens`; bound at Start).
 * Derive's REST command needs a compendium entry id a step can't read, so the creature is the
 * entity half of Derive (`entities.create` with `derivedFromId`, as `enemy-custom`), no Features.
 * `combat-1` is untouched (round 1, Wolf's turn).
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: [
    "trg-brakka",
    "uses-rage-spent",
    "trg-combat",
    "battlemap",
    "cmp-srd-mini",
    "ent-art-tokens",
  ],
  ownerSpec: "play-shell",
  steps: [
    step(
      togglePreset,
      (r): ToggleInput => ({
        characterId: r.id("char-brakka", ENTITY_TYPE),
        presetId: r.id("trg-brakka", EFFECT_PRESET_TYPE),
        on: true,
        overspend: true,
      }),
    ),
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "monster",
        name: "Crypt Ogre",
        derivedFromId: srdMiniMonsterId(r, "cmp-srd-mini", "ogre"),
        statBlock: { ...ogreBlock, size: "large" },
      }),
    ),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: cryptOgre(r),
      col: 18,
      row: 6,
    })),
    step(createEncounter, (r) => ({
      name: "Crypt",
      partyCharacterIds: null,
      entries: [
        { definitionId: cryptOgre(r), quantity: 1 },
        { definitionId: srdMiniMonsterId(r, "cmp-srd-mini", "goblin"), quantity: 1 },
      ],
    })),
  ],
});
