// FR-MAP-77: double-clicking a companion-marked token (FR-MAP-76) opens the companion card
// (`charx.companion`, FR-CHARX-59) for the DM and the token's owner; other players get nothing.
// On the active companion combatant bound to the token when there is one; otherwise (a pet out of
// a fight) the card opens with its picker as last used: players never receive the token's
// `definitionId` (FR-MAP-26, OQ-MAP-55). No-op while the card isn't registered (CP4).
import { isCompanion } from "@shared/combat-tracker/companion";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { SyncContext } from "@ui/sync/store";
import { useCallback, useContext, useRef } from "react";
import { useOpenWindow, useRegistry } from "../play-shell/ShellContext";
import { COMPANION_CARD_KIND, useOpenCompanionCard } from "./companion-card-request";
import { boundCombatant, isOwnedCompanionToken } from "./token-overlay";

/** What a double-click on `token` opens: null = nothing; `combatantId` null = the card as is. */
export function companionCardTarget(
  token: Pick<TokenView, "id" | "ownerPlayerId" | "characterId">,
  store: RecordStore,
  viewer: { role: "dm" | "player"; playerId: string | null },
): { combatantId: string | null } | null {
  if (!isOwnedCompanionToken(token)) return null;
  if (viewer.role === "player" && token.ownerPlayerId !== viewer.playerId) return null;
  const c = boundCombatant(store, token.id);
  return { combatantId: c && isCompanion(c) ? c.id : null };
}

export interface CompanionOpenDeps {
  store: RecordStore | undefined;
  /** `charx.companion` is in this client's window registry (CP4 merged). */
  hasCard: boolean;
  /** Opens the card on a combatant (`useOpenCompanionCard`, FR-CBT-119). */
  openCard(combatantId: string): void;
  /** Opens / fronts the card as it is (its picker as last used). */
  openCardAsIs(): void;
}

/** FR-MAP-77 on `client`: opens the card for `token` when it may; true when it did. */
export function openCompanionCardFor(
  token: Pick<TokenView, "id" | "ownerPlayerId" | "characterId">,
  client: "dm" | "player",
  deps: CompanionOpenDeps,
): boolean {
  const { store } = deps;
  if (!store || !deps.hasCard) return false;
  const target = companionCardTarget(token, store, {
    role: client,
    playerId: store.you?.playerId ?? null,
  });
  if (!target) return false;
  if (target.combatantId) deps.openCard(target.combatantId);
  else deps.openCardAsIs();
  return true;
}

/**
 * The double-click handler for `client`: true when it opened the card. Stable across renders
 * (MapCanvas memoises its token handlers on it).
 */
export function useCompanionTokenOpen(client: "dm" | "player"): (token: TokenView) => boolean {
  const sync = useContext(SyncContext);
  const registry = useRegistry();
  const openWindow = useOpenWindow();
  const openCard = useOpenCompanionCard();
  const latest = useRef({ sync, registry, openWindow, openCard });
  latest.current = { sync, registry, openWindow, openCard };
  return useCallback(
    (token: TokenView) => {
      const { sync, registry, openWindow, openCard } = latest.current;
      return openCompanionCardFor(token, client, {
        store: sync?.getState().store,
        hasCard: registry.get(COMPANION_CARD_KIND) !== undefined,
        openCard,
        openCardAsIs: () => openWindow(COMPANION_CARD_KIND, undefined, { by: "user" }),
      });
    },
    [client],
  );
}
