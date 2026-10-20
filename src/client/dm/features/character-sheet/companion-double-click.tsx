// FR-MAP-77: the DM's double-click on a companion-marked token (FR-MAP-76) opens the companion
// card; the registry's dialog mechanism runs it once on mount and closes at once (no dialog).
import { useCompanionTokenOpen } from "@ui/features/combat-tracker/companion-token-open";
import { isOwnedCompanionToken } from "@ui/features/combat-tracker/token-overlay";
import { useEffect, useRef } from "react";
import type { TokenDoubleClick, TokenMenuDialogProps } from "../scenes-map/token-menu";

function OpenCompanionCard({ token, close }: TokenMenuDialogProps) {
  const open = useCompanionTokenOpen("dm");
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    open(token);
    close();
  }, [open, token, close]);
  return null;
}

export const companionDoubleClick: TokenDoubleClick = {
  id: "charx.companion-card",
  order: 10,
  available: isOwnedCompanionToken,
  Dialog: OpenCompanionCard,
};
