// Player `charx.companion` (FR-CHARX-59): launcher "Companions", available iff the viewer owns a
// pet or an active companion combatant (OQ-CHARX-33); also opened by an own companion's
// Initiative row, Party's Card button or a double-click on its token (each selects it).
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { recordsOf } from "@shared/protocol/store";
import { CompanionCard } from "@ui/features/character-sheet/companion/CompanionCard";
import {
  type CompanionEntityLike,
  ownsCompanion,
} from "@ui/features/character-sheet/companion/picker";
import { companionWindowBase } from "@ui/features/character-sheet/companion/window";
import { startedIn } from "@ui/features/combat-tracker/store";
import { defineWindow } from "@ui/features/play-shell/registry";
import { PawPrintIcon } from "lucide-react";

export const playerCompanionWindow = defineWindow({
  ...companionWindowBase,
  clients: ["player"],
  launcher: { icon: PawPrintIcon, label: "Companions", order: 52 },
  available: (store) => {
    const enc = startedIn(store);
    const combatants = enc
      ? recordsOf<CombatantView>(store, COMBATANT_TYPE).filter((c) => c.encounterId === enc.id)
      : [];
    return ownsCompanion(
      store.you?.playerId ?? null,
      recordsOf<CompanionEntityLike>(store, ENTITY_TYPE),
      combatants,
    );
  },
  component: () => <CompanionCard />,
});
