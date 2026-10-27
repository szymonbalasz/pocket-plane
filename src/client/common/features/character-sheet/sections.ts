// Sheet sections contract (CHARX §7.1, FR-CHARX-34). The registry list lives in
// `./sheet-sections` (append-only); this file holds the contract and the pure selection rule.
// Sections get identity only and read the synced store themselves; they own their intents,
// test IDs, editing and lock rule.
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";

/**
 * `hp` (K11): the Hit Points box's Temp column (combat-extras' temp HP control is laid over it);
 * `vitals`: the vitals line under the stat row.
 */
export type SheetSlot = "header" | "hp" | "vitals" | "main" | "tab";
export type SheetClient = "dm" | "player";
export type SheetCreatureKind = "character" | "monster";

export interface SheetSection {
  /** `<prefix>.<name>`, e.g. `cbtx.death-saves`; test ID `charx-section` + `data-record-id`. */
  id: string;
  slot: SheetSlot;
  /** Ascending within the slot; ties by id. */
  order: number;
  /** Required for slot `tab` (the tab label). */
  title?: string;
  /** Default both. */
  clients?: readonly SheetClient[];
  /** Default `["character"]`. */
  kinds?: readonly SheetCreatureKind[];
  /** False → not rendered. */
  available?(store: RecordStore, creatureId: string): boolean;
  /**
   * Slot `tab` only: a count Badge on the tab label when > 0 (`charx-tab` `data-count`); null =
   * none. `loaded(type)`: whether a lazy type is loaded this snapshot generation (FR-SYNC-35), so
   * a count never shows rows merely present in the store (FR-CHARX-103).
   */
  count?(store: RecordStore, creatureId: string, loaded: (type: string) => boolean): number | null;
  component: ComponentType<{ creatureId: string; client: SheetClient }>;
}

export interface SectionContext {
  slot: SheetSlot;
  client: SheetClient;
  kind: SheetCreatureKind;
  store: RecordStore;
  creatureId: string;
}

/**
 * The sections a slot renders, in order: right slot, client and kind, `available` true. A
 * throwing `available` hides that section only (console warning). Duplicate ids or a `tab`
 * without a title are registration errors.
 */
export function sectionsFor(sections: readonly SheetSection[], c: SectionContext): SheetSection[] {
  const ids = new Set<string>();
  for (const s of sections) {
    if (ids.has(s.id)) throw new Error(`sheet section "${s.id}" registered twice`);
    ids.add(s.id);
    if (s.slot === "tab" && !s.title) throw new Error(`sheet section "${s.id}" needs a title`);
  }
  return sections
    .filter((s) => s.slot === c.slot)
    .filter((s) => (s.clients ?? ["dm", "player"]).includes(c.client))
    .filter((s) => (s.kinds ?? ["character"]).includes(c.kind))
    .filter((s) => {
      if (!s.available) return true;
      try {
        return s.available(c.store, c.creatureId);
      } catch (err) {
        console.warn(`sheet section ${s.id}: available() threw`, err);
        return false;
      }
    })
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A tab section's count Badge value (FR-CHARX-100): `count` when > 0, else null. A throwing
 * `count` shows no Badge (console warning), as `available`.
 */
export function sectionCount(
  s: SheetSection,
  store: RecordStore,
  creatureId: string,
  loaded: (type: string) => boolean,
): number | null {
  if (!s.count) return null;
  try {
    const n = s.count(store, creatureId, loaded);
    return n !== null && n > 0 ? n : null;
  } catch (err) {
    console.warn(`sheet section ${s.id}: count() threw`, err);
    return null;
  }
}
