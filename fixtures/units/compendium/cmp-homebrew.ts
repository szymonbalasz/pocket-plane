// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
import { adaptOpen5e } from "@server/features/compendium/adapter/open5e";
import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { EntryDraftOf } from "@shared/compendium/schemas";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { srdMini } from "../../srd/open5e";

/** Markers the leak scans look for (CMP §13). */
export const SECRET_ITEM_NAME = "CMP-SECRET-ITEM";
export const HOUSE_FIREBALL_NAME = "Fireball (house)";

/**
 * Divine Fury as trigger **data** (#209; no built-in, no subclass name): first weapon hit on
 * each own turn while raging, 1d6 + ⌊level(Barbarian) / 2⌋ radiant. `requires` keeps the
 * built-in key (FR-MOD-36, as `addTriggerFromPreset`).
 */
export const DIVINE_FURY_RULE: TriggerRule = {
  on: "hit",
  requires: { preset: "rage" },
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
};

/** Clone of the SRD Fireball (FR-CMP-25: an independent copy, no link). */
function houseFireball(): EntryDraftOf<"spell"> {
  const r = adaptOpen5e({ spells: srdMini.spells }).records.find(
    (x) => x.sourceKey === "spell/fireball",
  );
  if (r?.data.kind !== "spell") throw new Error("cmp-homebrew: Fireball missing from the mini set");
  return {
    ...r.data,
    name: HOUSE_FIREBALL_NAME,
    body: {
      ...r.data.body,
      text: `${r.data.body.text}\n\nHouse rule: the fire ignores resistance.`,
    },
  };
}

/**
 * CMP §13 `cmp-homebrew`: Fixture Campaign homebrew: item "Moonblade Shard" (shared), item
 * "CMP-SECRET-ITEM" (DM only), spell "Fireball (house)" cloned from Fireball (DM only), feature
 * "Divine Fury" (Barbarian, level 3, own words, inline `preset`; shared).
 */
export default defineFixture({
  key: "cmp-homebrew",
  kind: "setup",
  requires: ["campaign", "cmp-srd-mini"],
  ownerSpec: "compendium",
  steps: [
    step(putEntry, {
      shared: true,
      entry: {
        kind: "item",
        name: "Moonblade Shard",
        facets: { category: "magic", rarity: "rare", attunement: true },
        body: {
          typeLine: "Wondrous item",
          weight: "1 lb.",
          text: "A sliver of a broken moonblade. While you hold it, it sheds dim light in a 10-foot radius, and you can't be charmed.",
        },
      },
    }),
    step(putEntry, {
      entry: {
        kind: "item",
        name: SECRET_ITEM_NAME,
        facets: { category: "gear", attunement: false },
        body: { typeLine: "Adventuring gear", text: "The DM's secret: the key to the vault." },
      },
    }),
    step(putEntry, () => ({ entry: houseFireball() })),
    step(putEntry, {
      shared: true,
      entry: {
        kind: "feature",
        name: "Divine Fury",
        facets: { className: "Barbarian", level: 3 },
        body: {
          text: "Homebrew test feature (own words): in a rage, your first weapon hit each turn adds 1d6 + half your barbarian level radiant damage.",
          preset: DIVINE_FURY_RULE,
        },
      },
    }),
  ],
});
