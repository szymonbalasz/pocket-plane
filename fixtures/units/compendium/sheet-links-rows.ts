import { adaptOpen5e } from "@server/features/compendium/adapter/open5e";
import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { EntryDraftOf } from "@shared/compendium/schemas";
import { srdMini } from "../../srd/open5e";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

/** The campaign's own Bless, sharing its name with the SRD's (FR-CMP-77: two entries, one name). */
function houseBless(): EntryDraftOf<"spell"> {
  const r = adaptOpen5e({ spells: srdMini.spells }).records.find(
    (x) => x.sourceKey === "spell/bless",
  );
  if (r?.data.kind !== "spell")
    throw new Error("sheet-links-rows: Bless missing from the mini set");
  return r.data;
}

/**
 * FR-CMP-77, on top of `share-mira-rows` (Fireball, Hedge Whisper, Moonblade Shard): a shared
 * homebrew Bless, so that name has two entries, and Mira's rows named like entries: attack
 * Longsword (an item), spell Bless (two entries), spell "Fireball (house)" (DM only), feature
 * Sneak Attack.
 */
export default defineFixture({
  key: "sheet-links-rows",
  kind: "setup",
  requires: ["share-mira-rows"],
  ownerSpec: "compendium",
  steps: [
    step(putEntry, () => ({ shared: true, entry: houseBless() })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "attacks",
      row: { name: "Longsword", toHit: 5, damage: "1d8+3", damageType: "slashing" },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: { name: "Bless", level: 1, prepared: true },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: { name: "Fireball (house)", level: 3, prepared: true },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "features",
      row: { name: "Sneak Attack" },
    })),
  ],
});
