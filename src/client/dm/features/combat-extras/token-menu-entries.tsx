// combat-extras' token menu entries (FR-CBTX-35, registry FR-MAP-29): Conditions ▸, Effect…,
// Temp HP… on tokens bound to an active combatant; Add to combat on unbound tokens while an
// encounter runs. They act on every selected token of the same kind if the right-clicked one is
// in the selection, else on it alone (FR-MAP-31). Sprint 2 (FR-CBTX-45): Link to ‹Goblin 6›
// (submenu if several) on an unbound token; Unlink from combat on a bound one (this token only).
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { activeEffects, creatureOf, effectsOn } from "@ui/features/combat-extras/logic";
import { useCbtIntent, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { useRecords, useSync } from "@ui/sync/store";
import { HeartPulseIcon, LinkIcon, ShieldPlusIcon, UnlinkIcon, UserPlusIcon } from "lucide-react";
import { useMemo } from "react";
import { useMapSelection } from "../scenes-map/selection";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";
import { linkCandidates, linkedCombatant } from "./link";
import { ConditionsMenu, targetOf } from "./row";
import { useCbtxDialogs } from "./store";

/** The right-clicked token plus the rest of the selection if it is part of it. */
function useActedOn(token: TokenRecord): string[] {
  const sel = useMapSelection();
  return sel.tokenIds.includes(token.id) ? [...sel.tokenIds] : [token.id];
}

function useBoundOf(tokenIds: readonly string[]): CombatantView[] {
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  return useMemo(
    () =>
      tokenIds.flatMap((id) => {
        const c = all.find((x) => x.tokenId === id && x.active !== false && !x.removed);
        return c ? [c] : [];
      }),
    [all, tokenIds],
  );
}

/** Bound combatants acted on, or [] when the right-clicked token isn't bound. */
function useTargets(token: TokenRecord): CombatantView[] {
  const ids = useActedOn(token);
  const bound = useBoundOf(ids);
  return bound.some((c) => c.tokenId === token.id) ? bound : [];
}

export const cbtxTokenMenu: readonly TokenMenuEntry[] = [
  {
    id: "cbtx.conditions",
    order: 72,
    Item: function ConditionsItem({ token }: TokenMenuItemProps) {
      const cs = useTargets(token);
      const store = useSync((s) => s.store);
      if (cs.length === 0) return null;
      const fx = activeEffects(store);
      return (
        <>
          <DropdownMenuSeparator />
          <ConditionsMenu
            targets={cs.map((c) => ({
              target: targetOf(c),
              effects: effectsOn(fx, creatureOf(c)),
            }))}
            testId="cbtx-token-menu-conditions"
          />
        </>
      );
    },
  },
  {
    id: "cbtx.effect",
    order: 73,
    Item: function EffectItem({ token }: TokenMenuItemProps) {
      const cs = useTargets(token);
      const open = useCbtxDialogs((s) => s.openEffect);
      if (cs.length === 0) return null;
      return (
        <DropdownMenuItem
          data-testid="cbtx-token-menu-effect"
          onSelect={() => open(cs.map(targetOf))}
        >
          <ShieldPlusIcon /> Effect…
        </DropdownMenuItem>
      );
    },
  },
  {
    id: "cbtx.temp",
    order: 74,
    Item: function TempItem({ token }: TokenMenuItemProps) {
      const cs = useTargets(token);
      const open = useCbtxDialogs((s) => s.openTemp);
      if (cs.length === 0) return null;
      return (
        <DropdownMenuItem
          data-testid="cbtx-token-menu-temp"
          onSelect={() => open(cs.map(targetOf))}
        >
          <HeartPulseIcon /> Temp HP…
        </DropdownMenuItem>
      );
    },
  },
  {
    id: "cbtx.add",
    order: 75,
    Item: function AddItem({ token }: TokenMenuItemProps) {
      const enc = useStartedEncounter();
      const ids = useActedOn(token);
      const bound = useBoundOf(ids);
      const tokens = useRecords<TokenRecord>("token");
      const { send, disabled } = useCbtIntent();
      if (!enc || bound.some((c) => c.tokenId === token.id)) return null;
      const boundIds = new Set(bound.map((c) => c.tokenId));
      const unbound = ids.filter(
        (id) => !boundIds.has(id) && tokens.some((t) => t.id === id && t.sceneId === enc.sceneId),
      );
      if (unbound.length === 0) return null;
      return (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="cbtx-token-menu-add"
            disabled={disabled}
            onSelect={() =>
              void send(CBTX_INTENTS.addCombatants, {
                encounterId: enc.id,
                items: unbound.slice(0, 20).map((tokenId) => ({ tokenId })),
              })
            }
          >
            <UserPlusIcon /> Add to combat{unbound.length > 1 ? ` (${unbound.length})` : ""}
          </DropdownMenuItem>
        </>
      );
    },
  },
  {
    id: "cbtx.link",
    order: 76,
    Item: function LinkItem({ token }: TokenMenuItemProps) {
      const enc = useStartedEncounter();
      const all = useRecords<CombatantView>(COMBATANT_TYPE);
      const { send, disabled } = useCbtIntent();
      const cs = linkCandidates(token, all, enc ?? null);
      if (cs.length === 0) return null;
      const link = (c: CombatantView) =>
        void send(CBTX_INTENTS.bindToken, { combatantId: c.id, tokenId: token.id });
      if (cs.length === 1) {
        const c = cs[0] as CombatantView;
        return (
          <DropdownMenuItem
            data-testid="cbtx-token-menu-link"
            data-record-id={c.id}
            disabled={disabled}
            onSelect={() => link(c)}
          >
            <LinkIcon /> Link to {c.name}
          </DropdownMenuItem>
        );
      }
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>
            <LinkIcon /> Link to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {cs.map((c) => (
              <DropdownMenuItem
                key={c.id}
                data-testid="cbtx-token-menu-link"
                data-record-id={c.id}
                onSelect={() => link(c)}
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    },
  },
  {
    id: "cbtx.unlink",
    order: 77,
    Item: function UnlinkItem({ token }: TokenMenuItemProps) {
      const enc = useStartedEncounter();
      const all = useRecords<CombatantView>(COMBATANT_TYPE);
      const { send, disabled } = useCbtIntent();
      const c = linkedCombatant(token, all, enc ?? null);
      if (!c) return null;
      return (
        <DropdownMenuItem
          data-testid="cbtx-token-menu-unlink"
          disabled={disabled}
          onSelect={() => void send(CBTX_INTENTS.bindToken, { combatantId: c.id, tokenId: null })}
        >
          <UnlinkIcon /> Unlink from combat
        </DropdownMenuItem>
      );
    },
  },
];
