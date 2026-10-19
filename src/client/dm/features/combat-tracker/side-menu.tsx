// "Set as ally / enemy" (FR-CBT-104, #252) in the DM's Initiative row menu and token menu: a
// submenu with the "Secret" tick (players keep the side they were last openly shown, FR-CBT-100)
// and the set; while players see another side, "Set as <true side> (show players)" sets it openly
// (a reveal).
import { CBT_INTENTS, type CombatantView, type Side } from "@shared/combat-tracker/schemas";
import { Checkbox } from "@ui/components/ui/controls";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { sideMenuOf } from "@ui/features/combat-tracker/side";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { EyeIcon, HandshakeIcon, SwordsIcon } from "lucide-react";
import { useState } from "react";
import { useHoverSafeSub } from "./hover-sub";

const SIDE_ICON = { ally: HandshakeIcon, enemy: SwordsIcon } as const;

/** `testId`: the trigger's; its items add `-secret`, `-apply`, `-reveal`. */
export function SideMenu({ c, testId }: { c: CombatantView; testId: string }) {
  const { send, disabled } = useCbtIntent();
  const sub = useHoverSafeSub();
  const [secret, setSecret] = useState(false);
  const { to, label, reveal } = sideMenuOf(c);
  const Icon = SIDE_ICON[to];
  const set = (s: Side, sec: boolean) =>
    void send(CBT_INTENTS.setSide, { combatantId: c.id, side: s, secret: sec });
  return (
    <>
      <DropdownMenuSub open={sub.open} onOpenChange={sub.onOpenChange}>
        <DropdownMenuSubTrigger data-testid={testId} data-record-id={c.id} data-value={to}>
          <Icon /> {label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent onPointerEnter={sub.keep}>
          <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={secret}
            data-testid={`${testId}-secret`}
            data-record-id={c.id}
            data-value={secret}
            onSelect={(e) => {
              e.preventDefault();
              setSecret((v) => !v);
            }}
          >
            <Checkbox checked={secret} tabIndex={-1} aria-hidden className="pointer-events-none" />
            Secret
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid={`${testId}-apply`}
            data-record-id={c.id}
            data-value={to}
            disabled={disabled}
            onSelect={() => set(to, secret)}
          >
            <Icon /> {label}
            {secret && <span className="text-muted-foreground">(secret)</span>}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {reveal && (
        <DropdownMenuItem
          data-testid={`${testId}-reveal`}
          data-record-id={c.id}
          data-value={reveal}
          disabled={disabled}
          onSelect={() => set(reveal, false)}
        >
          <EyeIcon /> Set as {reveal}
          <span className="text-muted-foreground">(show players)</span>
        </DropdownMenuItem>
      )}
    </>
  );
}
