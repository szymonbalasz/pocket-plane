// DM `charx.companion` (FR-CHARX-59): no launcher; opened from a companion's Initiative row / line
// or Party (combat's and party's request, `useOpenCompanionCard`). Any companion; in a fight the
// HP button opens combat's Damage / heal dialog (FR-CHARX-63, FR-CBT-21) and the effect chips
// carry the Initiative row's menu (FR-CHARX-65). Both dialogs live with the Initiative window,
// which is opened along so they are mounted.
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { EffectView } from "@shared/combat-extras/schemas";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { Button } from "@ui/components/ui/button";
import { DropdownMenuItem } from "@ui/components/ui/menus";
import {
  CompanionCard,
  type CompanionDmParts,
} from "@ui/features/character-sheet/companion/CompanionCard";
import { companionWindowBase } from "@ui/features/character-sheet/companion/window";
import { activeEffects, effectsOn } from "@ui/features/combat-extras/logic";
import { EffectChips } from "@ui/features/combat-extras/parts";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useSync } from "@ui/sync/store";
import { HeartPulseIcon, PencilIcon, TrashIcon } from "lucide-react";
import { targetOf } from "../combat-extras/row";
import { useCbtxDialogs } from "../combat-extras/store";
import { useCombatDialogs } from "../combat-tracker/popup-store";

function HpButton({ c }: { c: CombatantView }) {
  const openHp = useCombatDialogs((s) => s.openHp);
  const openWindow = useOpenWindow();
  const live = useSync((s) => s.state === "live");
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 w-fit"
      data-testid="charx-companion-hp-adjust"
      data-value="dialog"
      disabled={!live}
      onClick={() => {
        openWindow(INITIATIVE_KIND);
        openHp(c.id);
      }}
    >
      <HeartPulseIcon className="size-3" />
      Damage / heal…
    </Button>
  );
}

function Effects({ c, round }: { c: CombatantView; round: number }) {
  const store = useSync((s) => s.store);
  const { send, disabled } = useCbtIntent();
  const openEffect = useCbtxDialogs((s) => s.openEffect);
  const openWindow = useOpenWindow();
  const effects = effectsOn(activeEffects(store), { combatantId: c.id });
  return (
    <EffectChips
      effects={effects}
      round={round}
      testId="charx-companion-effect"
      menu={(e: EffectView) => (
        <>
          <DropdownMenuItem
            data-testid="cbtx-init-row-effect-edit"
            data-record-id={e.id}
            onSelect={() => {
              openWindow(INITIATIVE_KIND);
              openEffect([targetOf(c)], e.id);
            }}
          >
            <PencilIcon /> Edit…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-testid="cbtx-init-row-effect-end"
            data-record-id={e.id}
            disabled={disabled}
            onSelect={() => void send(CBTX_INTENTS.endEffect, { effectId: e.id })}
          >
            <TrashIcon /> End
          </DropdownMenuItem>
        </>
      )}
    />
  );
}

export const dmCompanionParts: CompanionDmParts = {
  hpButton: (c) => <HpButton c={c} />,
  effects: (c, round) => <Effects c={c} round={round} />,
};

function DmCompanionCard() {
  return <CompanionCard dm={dmCompanionParts} />;
}

export const dmCompanionWindow = defineWindow({
  ...companionWindowBase,
  clients: ["dm"],
  component: DmCompanionCard,
});
