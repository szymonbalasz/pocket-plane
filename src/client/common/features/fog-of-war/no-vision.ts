// FR-FOG-17: the DM-only hint "No vision set for: ‹names›" (`fog-no-vision`): the owned tokens on
// the viewed scene whose creature's senses are all 0 (vision and darkvision 0 ft; absent senses or
// an unknown definition count as 0, FR-FOG-32). Names sorted, each once.
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE, type Senses } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";

export const NO_VISION_PREFIX = "No vision set for: ";

function sensesOf(records: RecordStore["records"], definitionId: string): Senses | undefined {
  const def = (records[ENTITY_TYPE]?.[definitionId] ??
    records[IMPORTED_ENTITY_TYPE]?.[definitionId]) as
    | { statBlock?: { senses?: Senses } }
    | undefined;
  return def?.statBlock?.senses;
}

export function noVisionNames(records: RecordStore["records"], sceneId: string): string[] {
  const names = new Set<string>();
  for (const r of Object.values(records[TOKEN_TYPE] ?? {})) {
    const t = r as TokenRecord;
    if (t.sceneId !== sceneId || t.ownerPlayerId == null) continue;
    const s = sensesOf(records, t.definitionId);
    if ((s?.visionFt ?? 0) === 0 && (s?.darkvisionFt ?? 0) === 0) names.add(t.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
