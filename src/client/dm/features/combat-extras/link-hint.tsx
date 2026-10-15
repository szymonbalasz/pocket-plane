// FR-CBTX-45: the attack popup's addition to "N selected not in combat": "Goblin 6 has no token:
// link it from the token menu" when a selected token not in combat matches a token-less
// combatant. Rendered by the popup next to its note; reads the map selection and the store.
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { useStartedEncounter } from "@ui/features/combat-tracker/store";
import { useRecords } from "@ui/sync/store";
import { useMapSelection } from "../scenes-map/selection";
import { linkHint } from "./link";

export function LinkHintNote() {
  const sel = useMapSelection();
  const enc = useStartedEncounter();
  const tokens = useRecords<TokenRecord>("token");
  const combatants = useRecords<CombatantView>(COMBATANT_TYPE);
  const text = linkHint(sel.tokenIds, tokens, combatants, enc ?? null);
  if (!text) return null;
  return (
    <span data-testid="cbtx-popup-link-hint" className="text-xs text-muted-foreground">
      — {text}
    </span>
  );
}
