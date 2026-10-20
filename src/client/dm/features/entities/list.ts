// Creatures list model (FR-ENT-18, ENT §7): pure, from synced records. Rows that fail their
// schema are omitted (FR-ENT-01); the server already drops them, this guards the client too.

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  type DefinitionRecord,
  definitionOrder,
  type EntityKind,
  EntityRecord,
  ImportedEntityRecord,
  xpForCr,
} from "@shared/entities/schemas";
import { nameTier, queryWords } from "@shared/search/match";
import { badgeLabel } from "@ui/features/compendium/logic";

export type CreatureTab = "all" | EntityKind;
export const CREATURE_TABS: readonly CreatureTab[] = ["all", "character", "monster"];

export interface CreatureRow {
  id: string;
  kind: EntityKind;
  name: string;
  portraitAssetId: string | null;
  /** Imported (global) definitions are read-only (FR-ENT-05). */
  readOnly: boolean;
  /** Source badge: `SRD` (imported), `Custom` (monster), owner name (character). */
  badge: string;
  cr: string | null;
  xp: number | null;
  /** Derived customs: base name, `(unknown)` if it can't be resolved; null if not derived. */
  derivedFrom: string | null;
  definition: DefinitionRecord;
}

export function creatureRows(
  entities: readonly unknown[],
  imported: readonly unknown[],
  players: readonly PlayerRecord[],
  tab: CreatureTab = "all",
): CreatureRow[] {
  const defs: DefinitionRecord[] = [];
  for (const r of entities) {
    const p = EntityRecord.safeParse(r);
    if (p.success) defs.push(p.data);
  }
  for (const r of imported) {
    const p = ImportedEntityRecord.safeParse(r);
    if (p.success) defs.push(p.data);
  }
  const names = new Map(defs.map((d) => [d.id, d.name]));
  const playerName = new Map(players.map((p) => [p.id, p.name]));
  return defs
    .filter((d) => tab === "all" || d.kind === tab)
    .sort(definitionOrder)
    .map((d) => {
      const readOnly = d.campaignId === null;
      const cr = d.kind === "monster" ? d.statBlock.cr : null;
      return {
        id: d.id,
        kind: d.kind,
        name: d.name,
        portraitAssetId: d.portraitAssetId,
        readOnly,
        badge: readOnly
          ? badgeLabel(d.source ?? "")
          : d.kind === "character"
            ? (playerName.get(d.ownerPlayerId) ?? "Unknown player")
            : "Custom",
        cr,
        xp: cr === null ? null : xpForCr(cr),
        derivedFrom: d.derivedFromId === null ? null : (names.get(d.derivedFromId) ?? "(unknown)"),
        definition: d,
      };
    });
}

/**
 * FR-ENT-18 search (S4, FR-CMP-37): the rows whose name matches every typed word per the shared
 * `nameTier` (0–3), by tier, then in `rows`' FR-ENT-18 order. Empty query → all rows.
 */
export function matchCreatureRows(rows: readonly CreatureRow[], q: string): CreatureRow[] {
  const words = queryWords(q);
  if (words.length === 0) return [...rows];
  return rows
    .map((r, i) => ({ r, i, tier: nameTier(r.name, words) }))
    .filter(
      (x): x is { r: CreatureRow; i: number; tier: NonNullable<typeof x.tier> } => x.tier !== null,
    )
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((x) => x.r);
}
