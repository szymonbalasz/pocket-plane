// The sheet's Macros tab (FR-CHARX-87–89; `sheet-sections.ts` line, `order: 90`, before SB's
// Trophies): the viewer's macros on this creature, each a roll button with ✎, and "+ Macro"
// preset to it. DM: always (all rows, "DM only" Badge); a player: on own characters. A locked
// sheet leaves macros editable (FR-CHARX-89: they are rolls, like counters). The list loads with
// the lazy `TableTools` chunk on first open.
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { createElement, lazy, Suspense } from "react";
import type { SheetSection } from "../character-sheet/sections";

const Panel = lazy(() => import("./MacrosPanel").then((m) => ({ default: m.MacrosPanel })));

function MacrosSection({ creatureId }: { creatureId: string }) {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(Panel, { only: creatureId, actorId: creatureId }),
  );
}

/** FR-CHARX-87: DM always; a player on characters they own. */
export function macrosAvailable(store: RecordStore, creatureId: string): boolean {
  const you = store.you;
  if (you?.role === "dm") return true;
  const c = store.records[ENTITY_TYPE]?.[creatureId] as
    | { kind?: string; ownerPlayerId?: string | null }
    | undefined;
  return c?.kind === "character" && !!you?.playerId && c.ownerPlayerId === you.playerId;
}

export const dicexMacrosSection: SheetSection = {
  id: "dicex.macros",
  slot: "tab",
  order: 90,
  title: "Macros",
  kinds: ["character", "monster"],
  available: macrosAvailable,
  component: MacrosSection,
};
