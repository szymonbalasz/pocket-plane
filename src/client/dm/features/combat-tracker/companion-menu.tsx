// Companion ▸ (FR-CBT-111, -118; sprint 6, #252) in the DM's Initiative row menu, companion line
// menu and token menu, over `cbt.setCompanion`: Owner ▸ (a PC of the fight: makes a monster a
// companion or moves it), Turn mode (three radio items), Release, Turn hostile. Hints only: the
// server decides (a pet's owner → "Change a pet's owner in the Party window", the turn
// combatant → "Change it after its turn"). Dismiss is the summon slice's (FR-CBT-112). Card
// (FR-CHARX-59, walkthrough 9): the menu item and the row / line icon open the companion card.
import { isCompanion } from "@shared/combat-tracker/companion";
import {
  CBT_INTENTS,
  type CombatantView,
  type SetCompanionInput,
} from "@shared/combat-tracker/schemas";
import { TURN_MODES, type TurnMode } from "@shared/entities/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { useOpenCompanionCard } from "@ui/features/combat-tracker/companion-card-request";
import { MODE_MENU_LABEL } from "@ui/features/combat-tracker/companions";
import { useCbtIntent, useCombatants } from "@ui/features/combat-tracker/store";
import { useSync } from "@ui/sync/store";
import { IdCardIcon, PawPrintIcon, SwordsIcon, UnlinkIcon, UserRoundIcon } from "lucide-react";
import { useMemo } from "react";
import { useHoverSafeSub } from "./hover-sub";

/** FR-CBT-111 (server's `PET_OWNER_HERE`): a pet's owner lives on the pet. */
export const PET_OWNER_HINT = "Change a pet's owner in the Party window";
const NOT_COMPANION = "Pick an owner first";

/** A PC of the fight that can own a companion (FR-CBT-105). */
export interface OwnerChoice {
  characterId: string;
  name: string;
  hasPlayer: boolean;
}

/** One menu item: `reason` = why it is disabled (Tooltip / muted text), else null. */
export interface MenuItemState {
  checked: boolean;
  reason: string | null;
}

/**
 * The menu's items for combatant `c` (DM): owners = the fight's active PCs (one per character),
 * disabled without a player ("Mira has no player") or on a pet; modes only for a companion;
 * Release / Turn hostile only for a companion that isn't a pet.
 */
export function companionMenuOf(
  c: Pick<CombatantView, "ownerCharacterId" | "turnMode" | "pet">,
  pcs: readonly OwnerChoice[],
): {
  owners: (OwnerChoice & MenuItemState)[];
  modes: ({ mode: TurnMode } & MenuItemState)[];
  release: string | null;
} {
  const companion = isCompanion(c);
  const petLock = c.pet ? PET_OWNER_HINT : null;
  return {
    owners: pcs.map((p) => ({
      ...p,
      checked: c.ownerCharacterId === p.characterId,
      reason: petLock ?? (p.hasPlayer ? null : `${p.name} has no player`),
    })),
    modes: TURN_MODES.map((mode) => ({
      mode,
      checked: companion && c.turnMode === mode,
      reason: companion ? null : NOT_COMPANION,
    })),
    release: companion ? petLock : NOT_COMPANION,
  };
}

/** The intent each item sends (FR-CBT-111; turn hostile = release + an open side to enemy). */
export const companionIntent = {
  owner: (c: Pick<CombatantView, "id" | "turnMode">, characterId: string): SetCompanionInput => ({
    combatantId: c.id,
    owner: { characterId, ...(c.turnMode ? { turnMode: c.turnMode } : {}) },
  }),
  mode: (c: Pick<CombatantView, "id" | "ownerCharacterId">, turnMode: TurnMode) => ({
    combatantId: c.id,
    owner: { characterId: c.ownerCharacterId ?? "", turnMode },
  }),
  release: (c: Pick<CombatantView, "id">): SetCompanionInput => ({
    combatantId: c.id,
    owner: null,
  }),
  hostile: (c: Pick<CombatantView, "id">): SetCompanionInput => ({
    combatantId: c.id,
    owner: null,
    side: "enemy",
  }),
};

/** The started fight's active PCs as owner choices, by rank (their characters' players). */
function useOwnerChoices(encounterId: string | undefined): OwnerChoice[] {
  const rows = useCombatants(encounterId);
  const entities = useSync((s) => s.store.records.entity);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: OwnerChoice[] = [];
    for (const r of rows) {
      if (r.kind !== "pc" || r.removed || r.active === false || !r.entityId) continue;
      if (seen.has(r.entityId)) continue;
      seen.add(r.entityId);
      const ch = entities?.[r.entityId] as { ownerPlayerId?: string | null } | undefined;
      out.push({ characterId: r.entityId, name: r.name, hasPlayer: Boolean(ch?.ownerPlayerId) });
    }
    return out;
  }, [rows, entities]);
}

/**
 * FR-CHARX-59 (walkthrough 9): a companion row's / line's card icon (`cbt-init-row-card`, as the
 * player's) opening `charx.companion` on it; nothing on a non-companion.
 */
export function CompanionCardButton({ c }: { c: CombatantView }) {
  const openCard = useOpenCompanionCard();
  if (!isCompanion(c)) return null;
  return (
    <Tooltip content={`${c.name}'s card`}>
      <Button
        size="icon"
        variant="ghost"
        className="size-5 shrink-0"
        data-testid="cbt-init-row-card"
        data-record-id={c.id}
        aria-label={`Open ${c.name}'s card`}
        onClick={(e) => {
          e.stopPropagation();
          openCard(c.id);
        }}
      >
        <IdCardIcon className="size-3.5" />
      </Button>
    </Tooltip>
  );
}

/** Companion ▸ for a monster combatant; `testId` = the trigger's (`cbt-init-row-companion`). */
export function CompanionMenu({ c, testId }: { c: CombatantView; testId: string }) {
  const openCard = useOpenCompanionCard();
  const { send, disabled } = useCbtIntent();
  const sub = useHoverSafeSub();
  const ownerSub = useHoverSafeSub();
  const pcs = useOwnerChoices(c.encounterId);
  if (c.kind !== "monster") return null;
  const menu = companionMenuOf(c, pcs);
  const set = (body: SetCompanionInput) => void send(CBT_INTENTS.setCompanion, body);
  return (
    <DropdownMenuSub open={sub.open} onOpenChange={sub.onOpenChange}>
      <DropdownMenuSubTrigger data-testid={testId} data-record-id={c.id}>
        <PawPrintIcon /> Companion
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent onPointerEnter={sub.keep} className="min-w-52">
        {isCompanion(c) && (
          <>
            <DropdownMenuItem
              data-testid="cbt-companion-card"
              data-record-id={c.id}
              onSelect={() => openCard(c.id)}
            >
              <IdCardIcon /> Card
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuSub open={ownerSub.open} onOpenChange={ownerSub.onOpenChange}>
          <DropdownMenuSubTrigger data-testid="cbt-companion-owner-menu" data-record-id={c.id}>
            <UserRoundIcon /> Owner
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            onPointerEnter={() => {
              sub.keep();
              ownerSub.keep();
            }}
          >
            {menu.owners.length === 0 && (
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                No character in this fight
              </DropdownMenuLabel>
            )}
            <DropdownMenuRadioGroup value={c.ownerCharacterId ?? ""}>
              {menu.owners.map((o) => (
                <DropdownMenuRadioItem
                  key={o.characterId}
                  value={o.characterId}
                  data-testid="cbt-companion-owner"
                  data-record-id={o.characterId}
                  data-checked={o.checked}
                  disabled={disabled || o.reason !== null}
                  title={o.reason ?? undefined}
                  onSelect={() => {
                    if (!o.checked) set(companionIntent.owner(c, o.characterId));
                  }}
                >
                  <span className="flex flex-col">
                    {o.name}
                    {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Turn mode
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={c.turnMode ?? ""}>
          {menu.modes.map((m) => (
            <DropdownMenuRadioItem
              key={m.mode}
              value={m.mode}
              data-testid="cbt-companion-mode"
              data-record-id={c.id}
              data-value={m.mode}
              data-checked={m.checked}
              disabled={disabled || m.reason !== null}
              onSelect={() => {
                if (!m.checked) set(companionIntent.mode(c, m.mode));
              }}
            >
              {MODE_MENU_LABEL[m.mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="cbt-companion-release"
          data-record-id={c.id}
          disabled={disabled || menu.release !== null}
          title={menu.release ?? undefined}
          onSelect={() => set(companionIntent.release(c))}
        >
          <UnlinkIcon /> Release
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          data-testid="cbt-companion-hostile"
          data-record-id={c.id}
          disabled={disabled || menu.release !== null}
          title={menu.release ?? undefined}
          onSelect={() => set(companionIntent.hostile(c))}
        >
          <SwordsIcon /> Turn hostile
        </DropdownMenuItem>
        {c.pet && (
          <DropdownMenuLabel className="max-w-52 font-normal text-xs text-muted-foreground">
            {PET_OWNER_HINT}
          </DropdownMenuLabel>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
