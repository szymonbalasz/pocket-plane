// FR-FOG-17: the DM-only hint "No vision set for: ‹names›" (`fog-no-vision`): the owned tokens on
// the viewed scene whose creature's senses are stored 0 / 0 (vision and darkvision 0 ft). Sprint 4
// (FR-FOG-32, OQ-FOG-51): absent senses or an absent `visionFt` = Normal (999 ft), so they are not
// listed; nor is an unknown definition (not loaded yet). Names sorted, each once. Imported
// definitions come from `useDefinitions` (lazy, FR-CMP-16): `noVisionDefinitionIds` says which
// to load.
import { ENTITY_TYPE, type Senses } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";

export const NO_VISION_PREFIX = "No vision set for: ";

type SensesHolder = { statBlock?: { senses?: Senses } };

function sensesOf(
  records: RecordStore["records"],
  definitions: ReadonlyMap<string, SensesHolder>,
  definitionId: string,
): Senses | undefined {
  const def =
    (records[ENTITY_TYPE]?.[definitionId] as SensesHolder | undefined) ??
    definitions.get(definitionId);
  return def?.statBlock?.senses;
}

function ownedTokens(records: RecordStore["records"], sceneId: string): TokenRecord[] {
  return Object.values(records[TOKEN_TYPE] ?? {})
    .map((r) => r as TokenRecord)
    .filter((t) => t.sceneId === sceneId && t.ownerPlayerId != null);
}

/** The owned tokens' definitions on the scene (what `useDefinitions` should hold). */
export function noVisionDefinitionIds(records: RecordStore["records"], sceneId: string): string[] {
  return [...new Set(ownedTokens(records, sceneId).map((t) => t.definitionId))].sort();
}

/** `definitions`: imported ones from `useDefinitions(noVisionDefinitionIds(…))`. */
export function noVisionNames(
  records: RecordStore["records"],
  sceneId: string,
  definitions: ReadonlyMap<string, SensesHolder> = new Map(),
): string[] {
  const names = new Set<string>();
  for (const t of ownedTokens(records, sceneId)) {
    const s = sensesOf(records, definitions, t.definitionId);
    if (s?.visionFt === 0 && s.darkvisionFt === 0) names.add(t.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
