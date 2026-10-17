// Refs to the imported definitions of the mini recorded set (`cmp-srd-mini`, `cmp-srd-mini-s3`):
// the import creates them in `srdMini.monsters` order (FR-CMP-03), so a slug's index is its ref.
import type { Refs } from "@server/features/fixtures-adapters/fixture-types";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { srdMini } from "../../srd/open5e";

export type SrdMiniMonster = "goblin" | "hobgoblin" | "wolf" | "ogre" | "adult-red-dragon";

export function srdMiniMonsterId(
  r: Refs,
  fixtureKey: "cmp-srd-mini" | "cmp-srd-mini-s3",
  slug: SrdMiniMonster,
): string {
  const i = (srdMini.monsters ?? []).findIndex((m) => (m as { slug: string }).slug === slug);
  if (i < 0) throw new Error(`srd mini: no monster "${slug}"`);
  return r.id(fixtureKey, IMPORTED_ENTITY_TYPE, i);
}
