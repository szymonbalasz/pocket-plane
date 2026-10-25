// Player `cbt.initiative` (CBT §7), read-only: Round N; rows by `playerPosition` with the turn
// marker (`playerTurnCombatantId`), portrait, name, the side chip of the side they were openly
// shown (FR-CBT-100, -104), band (monsters, any side) or Down (PCs, FR-CBT-49),
// initiative (PCs); effect chips the player receives (one line + "+N"; then own PCs' trigger
// chips, FR-CBTX-52) and PCs' death state
// (own PC with pips, FR-CBTX-34). Removed combatants reach players (FR-CBT-37, map badge) but
// leave this list. Companion: the turn alert + the concentration roll host (FR-CBTX-37). Sprint 6
// (FR-CBT-119): companions' owner chip and mode icon for everyone; the owner sees HP numbers and a
// card icon; in-turn companions are lines in the owner's row.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
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
import { useOpenCompanionCard } from "@ui/features/combat-tracker/companion-card-request";
import {
  companionLayout,
  ModeIcon,
  modeLabel,
  OwnerChip,
} from "@ui/features/combat-tracker/companions";
import { BandBadge, Portrait, SideChip, TurnMarker } from "@ui/features/combat-tracker/parts";
import { startedIn, useCombatants, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { pcDown } from "@ui/features/combat-tracker/token-overlay";
import { TurnAlertRuntime } from "@ui/features/combat-tracker/turn-alert-runtime";
import { initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { triggerChipsFor, useTriggerWords } from "@ui/features/effect-modifiers/trigger-badges";
import { defineWindow } from "@ui/features/play-shell/registry";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { IdCardIcon } from "lucide-react";
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

/**
 * One row's content (an in-turn companion's line is `PlayerCompanionLine`): portrait, name line with
 * the side chip and (sprint 6) the owner chip and mode icon, effect chips, death state; band (a
 * monster) or, for the companion's owner, HP "45 / 59" and the card icon (FR-CBT-119); PCs'
 * initiative.
 */
function PlayerRowMain({
  c,
  ownerName,
  turn,
  round,
  me,
}: {
  c: CombatantView;
  ownerName: string;
  turn: boolean;
  round: number;
  me: string | null;
}) {
  const store = useSync((s) => s.store);
  const openCard = useOpenCompanionCard();
  const fx = activeEffects(store);
  const ch = c.kind === "pc" ? characterOf(store, c.entityId ?? "") : undefined;
  const death = deathStateFor(ch);
  const counters = countersFor(ch);
  const companion = Boolean(c.ownerCharacterId && c.turnMode);
  // FR-CBT-116: only the owner receives a companion's HP numbers.
  const own = companion && me !== null && c.ownerPlayerId === me;
  return (
    // FR-CBT-119: a click on an own companion's row opens its card (the icon is the button).
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the card icon is the keyboard path
    // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the card icon is the keyboard path
    <div
      data-row-main
      className={cn("flex items-center gap-1", own && "cursor-pointer")}
      onClick={own ? () => openCard(c.id) : undefined}
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
          marks={
            companion && (
              <ModeIcon
                id={c.id}
                mode={c.turnMode ?? "after-owner"}
                ownerName={ownerName}
                testId="cbt-init-row-mode"
              />
            )
          }
          // FR-CBT-104: never folds, before the effect chips (FR-CBTX-54). Sprint 6: the owner
          // chip with it (FR-CBT-119; a line sits in its owner's row).
          side={
            <>
              {companion && <OwnerChip c={c} ownerName={ownerName} testId="cbt-init-row-owner" />}
              <SideChip c={c} testId="cbt-init-row-ally" />
            </>
          }
        >
          <EffectChips
            compact
            effects={effectsOn(fx, creatureOf(c))}
            triggers={triggerChipsFor(store, c)}
            round={round}
            testId="cbtx-init-row-effect"
          />
        </NameLine>
        {/* FR-CBT-107 (walkthrough fix): an `after-owner` row says whose turn it follows. */}
        {companion && c.turnMode === "after-owner" && (
          <span
            data-testid="cbt-init-row-after"
            data-record-id={c.id}
            className="text-xs text-muted-foreground"
          >
            {modeLabel("after-owner", ownerName)}
          </span>
        )}
        {/* FR-CBTX-34: a PC's death state (own PC with pips) replaces the plain Down; on
            its own line under the name. */}
        {death && (
          <div className="flex items-center gap-1">
            {counters && <DeathPips c={counters} />}
            <DeathBadge state={death} testId="cbtx-init-row-death" />
          </div>
        )}
      </div>
      {own ? (
        <span
          data-testid="cbt-init-row-hp"
          data-record-id={c.id}
          className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {c.hpCurrent ?? "—"} / {c.hpMax ?? "—"}
        </span>
      ) : (
        c.kind === "monster" && c.band && <BandBadge band={c.band} testId="cbt-init-row-band" />
      )}
      {own && <OwnCardButton c={c} />}
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
    </div>
  );
}

/** FR-CBT-119: the owner's card icon (opens the companion card, FR-CHARX-59). */
function OwnCardButton({ c }: { c: CombatantView }) {
  const openCard = useOpenCompanionCard();
  return (
    <Tooltip content={`${c.name}'s card`}>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0"
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

/**
 * FR-CBT-142 per viewer (OQ-CBT-93 A, sprint 7): an `in-owner-turn` companion's one-row line in
 * its owner's row. The owner: name, "45 / 59" (+ temp), AC from its `card`, chips, card icon
 * (no ⋯: the card holds the owner's actions). Another player: name, band, chips (no AC, no card).
 * `NameLine` fits it (FR-CBTX-57); names break between words only (FR-CBT-143).
 */
function PlayerCompanionLine({
  c,
  ownerName,
  round,
  me,
}: {
  c: CombatantView;
  ownerName: string;
  round: number;
  me: string | null;
}) {
  const store = useSync((s) => s.store);
  const openCard = useOpenCompanionCard();
  const fx = activeEffects(store);
  // FR-CBT-116: only the owner receives a companion's HP numbers and card.
  const own = me !== null && c.ownerPlayerId === me;
  const temp = c.tempHp ?? 0;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the card icon is the keyboard path
    // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the card icon is the keyboard path
    <div
      data-row-main
      className={cn("flex min-w-0 items-center", own && "cursor-pointer")}
      onClick={own ? () => openCard(c.id) : undefined}
    >
      <div className="min-w-0 flex-1">
        <NameLine
          name={c.name}
          testId="cbt-init-row-name"
          className="text-sm"
          marks={
            <ModeIcon
              id={c.id}
              mode={c.turnMode ?? "in-owner-turn"}
              ownerName={ownerName}
              testId="cbt-init-row-mode"
            />
          }
          side={
            own ? (
              <span
                data-stats-line
                className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
              >
                <span className="shrink-0" data-testid="cbt-init-row-hp" data-record-id={c.id}>
                  {c.hpCurrent ?? "—"} / {c.hpMax ?? "—"}
                </span>
                {temp > 0 && (
                  <span
                    data-testid="cbtx-init-row-temp"
                    data-record-id={c.id}
                    className="shrink-0 text-hp-temp"
                  >
                    +{temp}
                  </span>
                )}
                <span className="shrink-0" data-testid="cbt-init-row-ac" data-record-id={c.id}>
                  AC {c.card?.ac ?? "—"}
                </span>
              </span>
            ) : (
              c.band && <BandBadge band={c.band} testId="cbt-init-row-band" />
            )
          }
          end={
            own && (
              <span data-name-end className="ml-auto flex shrink-0">
                <OwnCardButton c={c} />
              </span>
            )
          }
        >
          <EffectChips
            compact
            effects={effectsOn(fx, creatureOf(c))}
            triggers={triggerChipsFor(store, c)}
            round={round}
            testId="cbtx-init-row-effect"
          />
        </NameLine>
      </div>
    </div>
  );
}

/**
 * One player Initiative row; sprint 6 (FR-CBT-119): companions ranked by their owner indented,
 * `in-owner-turn` ones as lines inside the owner's row (`cbt-init-companion`).
 */
export function PlayerRow({
  c,
  lines,
  ownerName,
  indent,
  turn,
  round,
  me,
}: {
  c: CombatantView;
  lines: readonly CombatantView[];
  ownerName: string;
  indent: boolean;
  turn: boolean;
  round: number;
  me: string | null;
}) {
  return (
    <li
      data-testid="cbt-init-row"
      data-record-id={c.id}
      data-turn={turn}
      data-hidden="false"
      data-indent={indent || undefined}
      className={cn(
        "flex shrink-0 flex-col gap-0.5 rounded-md px-1 py-0.5",
        turn && "bg-accent",
        indent && "ml-3",
      )}
    >
      <PlayerRowMain c={c} ownerName={ownerName} turn={turn} round={round} me={me} />
      {lines.map((l) => (
        <div
          key={l.id}
          data-testid="cbt-init-companion"
          data-record-id={l.id}
          className="border-l border-border/60 pl-1"
        >
          <PlayerCompanionLine c={l} ownerName={c.name} round={round} me={me} />
        </div>
      ))}
    </li>
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
  // FR-CBT-107 / -119 (sprint 6): in-turn companions as lines in their owner's row.
  const layout = companionLayout(rows, "playerPosition");
  const ownerNameOf = (c: CombatantView) =>
    (c.ownerCharacterId ? characterOf(store, c.ownerCharacterId)?.name : undefined) ?? "";
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
        {layout.map(({ c, lines, owner, indent }) => (
          <PlayerRow
            key={c.id}
            c={c}
            lines={lines}
            ownerName={owner?.name ?? ownerNameOf(c)}
            indent={indent}
            turn={enc.playerTurnCombatantId === c.id}
            round={enc.round}
            me={me}
          />
        ))}
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
  // FR-SHELL-100: header + 4 rows (play-shell §7 sprint-8 useful sizes).
  usefulSize: { w: 280, h: 320 },
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
