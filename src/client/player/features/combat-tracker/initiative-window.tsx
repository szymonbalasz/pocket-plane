// Player `cbt.initiative` (CBT §7), read-only: Round N; rows by `playerPosition` with the turn
// marker (`playerTurnCombatantId`), portrait, name, the side chip of the side they were openly
// shown (FR-CBT-100, -104), band (monsters, any side) or Down (PCs, FR-CBT-49),
// initiative (PCs); effect chips the player receives (one line + "+N"; then own PCs' trigger
// chips, FR-CBTX-52) and PCs' death state
// (own PC with pips, FR-CBTX-34). Removed combatants reach players (FR-CBT-37, map badge) but
// leave this list. Companion: the turn alert + the concentration roll host (FR-CBTX-37).
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { Skeleton } from "@ui/components/ui/primitives";
import { ConcentrationRollHost } from "@ui/features/combat-extras/concentration";
import {
  activeEffects,
  characterOf,
  countersFor,
  creatureOf,
  deathStateFor,
  effectsOn,
} from "@ui/features/combat-extras/logic";
import { DeathBadge, DeathPips, EffectChips, NameLine } from "@ui/features/combat-extras/parts";
import { MoreFooter, useBelowFold, useListViewport } from "@ui/features/combat-tracker/below-fold";
import { BandBadge, Portrait, SideChip, TurnMarker } from "@ui/features/combat-tracker/parts";
import { startedIn, useCombatants, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { pcDown } from "@ui/features/combat-tracker/token-overlay";
import { TurnAlertRuntime } from "@ui/features/combat-tracker/turn-alert-runtime";
import { initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { triggerChipsFor, useTriggerWords } from "@ui/features/effect-modifiers/trigger-badges";
import { defineWindow } from "@ui/features/play-shell/registry";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { useRef } from "react";

/** Mounted while an encounter runs: turn alert (FR-CBT-41), concentration roll host (FR-CBTX-37). */
function PlayerCombatRuntime() {
  return (
    <>
      <TurnAlertRuntime />
      <ConcentrationRollHost />
    </>
  );
}

function PlayerInitiativeBody() {
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id).filter((c) => !c.removed);
  const me = useSync((s) => s.store.you?.playerId ?? null);
  const characters = useRecords<{ id: string; ownerPlayerId?: string | null }>("entity");
  const everLive = useSync((s) => s.everLive);
  const store = useSync((s) => s.store);
  useTriggerWords();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const footerRef = useRef<HTMLButtonElement>(null);
  const ids = rows.map((c) => c.id);
  // FR-CBT-77 (G4): new rows (Start, reveal) scroll into view; "↓ N more" below the fold.
  const fold = useBelowFold(rootRef, footerRef, ids);
  // FR-CBT-125: the row list clips and scrolls; the footer sits under it.
  const clip = useListViewport(rootRef, listRef, footerRef, ids);
  if (!everLive || !enc) return <Skeleton className="h-24" />;
  const fx = activeEffects(store);
  const mine = new Set(characters.filter((c) => c.ownerPlayerId === me).map((c) => c.id));
  const ownWithout = rows.some(
    (c: CombatantView) => c.kind === "pc" && mine.has(c.entityId ?? "") && c.initiative == null,
  );
  return (
    // Round + hint stay put; the rows scroll inside the window, in their own clipping viewport
    // above "↓ N more" (FR-CBT-125).
    <div
      ref={rootRef}
      data-testid="cbt-init"
      data-record-id={enc.id}
      className="flex h-full min-h-0 flex-col gap-2"
      style={clip === null ? undefined : { maxHeight: clip }}
    >
      <span
        data-testid="cbt-init-round"
        data-value={enc.round}
        className="shrink-0 text-sm font-semibold"
      >
        {enc.round === 0 ? "Rolling initiative" : `Round ${enc.round}`}
      </span>
      {ownWithout && (
        <p data-testid="cbt-init-hint" className="shrink-0 text-xs text-muted-foreground">
          Roll initiative on your sheet
        </p>
      )}
      <ul
        ref={listRef}
        data-testid="cbt-init-list"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {rows.map((c) => {
          const turn = enc.playerTurnCombatantId === c.id;
          const ch = c.kind === "pc" ? characterOf(store, c.entityId ?? "") : undefined;
          const death = deathStateFor(ch);
          const counters = countersFor(ch);
          return (
            <li
              key={c.id}
              data-testid="cbt-init-row"
              data-record-id={c.id}
              data-turn={turn}
              data-hidden="false"
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5",
                turn && "bg-accent",
              )}
            >
              <TurnMarker active={turn} />
              <Portrait name={c.name} imageAssetId={c.imageAssetId} />
              <div className="flex min-w-0 flex-1 flex-col">
                {/* FR-CBTX-46 (P3 glitch 6), FR-CBTX-57: chips get the width left after the full
                    name and the side chip, as on the DM's rows; the name is never cut. */}
                <NameLine
                  name={c.name}
                  testId="cbt-init-row-name"
                  className="text-sm"
                  // FR-CBT-104: never folds, before the effect chips (FR-CBTX-54).
                  side={<SideChip c={c} testId="cbt-init-row-ally" />}
                >
                  <EffectChips
                    compact
                    effects={effectsOn(fx, creatureOf(c))}
                    triggers={triggerChipsFor(store, c)}
                    round={enc.round}
                    testId="cbtx-init-row-effect"
                  />
                </NameLine>
                {/* FR-CBTX-34: a PC's death state (own PC with pips) replaces the plain Down; on
                    its own line under the name. */}
                {death && (
                  <div className="flex items-center gap-1">
                    {counters && <DeathPips c={counters} />}
                    <DeathBadge state={death} testId="cbtx-init-row-death" />
                  </div>
                )}
              </div>
              {c.kind === "monster" && c.band && (
                <BandBadge band={c.band} testId="cbt-init-row-band" />
              )}
              {/* FR-CBT-49 (#172): a PC at 0 HP (own HP, else the redacted `down`). */}
              {!death && pcDown(store, c) && <BandBadge band="down" testId="cbt-init-row-band" />}
              {c.kind === "pc" && (
                <span
                  data-testid="cbt-init-row-init"
                  data-record-id={c.id}
                  className="w-8 text-right text-xs tabular-nums text-muted-foreground"
                >
                  {c.initiative ?? "—"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <MoreFooter footerRef={footerRef} more={fold.more} onClick={fold.scrollToMore} />
    </div>
  );
}

export const playerInitiativeWindow = defineWindow({
  ...initiativeWindowBase,
  clients: ["player"],
  // Player left edge, clear of the tool rail, above `dice.log` (FR-SHELL-50, #256; protocol §24):
  // token-free 68, 60; at Start auto-placed in the left column, y by token cover. Compact:
  // read-only rows.
  defaultSize: { w: 280, h: 400 },
  minSize: { w: 240, h: 200 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  // FR-CBT-77 (G4): grows to its rows until resized (FR-SHELL-39, -52); "new" dot while minimised
  // on a round / turn change (players never get `turnCombatantId`).
  growToContent: true,
  activity: (store) => {
    const enc = startedIn(store);
    return enc ? `${enc.round}:${enc.playerTurnCombatantId ?? ""}` : null;
  },
  available: (store) => startedIn(store) !== null,
  component: PlayerInitiativeBody,
  companion: PlayerCombatRuntime,
});
