// FR-CBT-119 → FR-CHARX-59: the owner's card icon (and a click on an own companion's Initiative
// row) opens the companion card on that companion. Combat only asks: it records the requested
// combatant id here and opens `charx.companion`; the card (CP4) selects the latest request.
import { create } from "zustand";
import { useOpenWindow } from "../play-shell/ShellContext";

/** The companion card's window kind (character-sheet-full, FR-CHARX-59). */
export const COMPANION_CARD_KIND = "charx.companion";

interface CardRequest {
  /** The combatant (or pet) id last asked for; null = none. */
  id: string | null;
  /** Bumped per request, so asking for the same companion again re-selects it. */
  n: number;
  request(id: string): void;
}

export const useCompanionCardRequest = create<CardRequest>()((set) => ({
  id: null,
  n: 0,
  request: (id) => set((s) => ({ id, n: s.n + 1 })),
}));

/** Opens the companion card on `id` (FR-CBT-119). */
export function useOpenCompanionCard(): (id: string) => void {
  const open = useOpenWindow();
  const request = useCompanionCardRequest((s) => s.request);
  return (id: string) => {
    request(id);
    open(COMPANION_CARD_KIND, undefined, { by: "user" });
  };
}
