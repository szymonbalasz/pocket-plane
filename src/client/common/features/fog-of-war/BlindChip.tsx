// FR-FOG-21 / -36: the blind chip over the player's canvas (`fog-blind`), shown while the
// player is blind (own `vision` row; party vision on: the whole party, FR-FOG-50). Canvas only
// (OQ-FOG-40): windows stay. The canvas runs under the top bar (z-20), so the chip sits below it,
// like the tool rail. Sprint 4 (FR-FOG-48): text and `data-reason` by reason (`darkness` |
// `blinded` | `unknown`), read from the sync store unless given.
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { MoonIcon } from "lucide-react";
import { useContext } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { SyncContext } from "../../sync/store";
import { TOP_BAR_H } from "../play-shell/geometry";
import { blindReasonOf } from "./blind";
import { BLIND_TEXTS, type ChipReason } from "./party-view";

/** The chip's top offset in px: clear of the top bar (FOG §13 step 9). */
export const BLIND_CHIP_TOP = TOP_BAR_H + 8;

type StoreOnly = StoreApi<{ store: RecordStore }>;
const NO_SYNC: StoreOnly = createStore(() => ({ store: emptyStore() }));

export function FogBlindChip({ blind, reason }: { blind: boolean; reason?: ChipReason }) {
  const sync = (useContext(SyncContext) as StoreOnly | null) ?? NO_SYNC;
  const read = useStore(sync, (s) => (blind && !reason ? blindReasonOf(s.store) : null));
  if (!blind) return null;
  const r: ChipReason = reason ?? read ?? "darkness";
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
      style={{ top: BLIND_CHIP_TOP }}
    >
      <span
        data-testid="fog-blind"
        data-reason={r}
        role="status"
        className="flex items-center gap-1.5 rounded-md bg-background/90 px-3 py-1.5 text-center text-sm text-foreground shadow-sm"
      >
        <MoonIcon className="size-4 shrink-0" />
        {BLIND_TEXTS[r]}
      </span>
    </div>
  );
}
