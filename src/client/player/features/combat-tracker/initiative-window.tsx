// Player `cbt.initiative` (CBT §7), read-only: Round N; rows by `playerPosition` with the turn
// marker (`playerTurnCombatantId`), portrait, name, band (monsters), initiative (PCs). Removed
// combatants reach players (FR-CBT-37, map badge) but leave this list. Companion: the turn alert.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { Skeleton } from "@ui/components/ui/primitives";
import { BandBadge, Portrait, TurnMarker } from "@ui/features/combat-tracker/parts";
import { startedIn, useCombatants, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { TurnAlertRuntime } from "@ui/features/combat-tracker/turn-alert-runtime";
import { initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";

function PlayerInitiativeBody() {
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id).filter((c) => !c.removed);
  const me = useSync((s) => s.store.you?.playerId ?? null);
  const characters = useRecords<{ id: string; ownerPlayerId?: string | null }>("entity");
  const everLive = useSync((s) => s.everLive);
  if (!everLive || !enc) return <Skeleton className="h-24" />;
  const mine = new Set(characters.filter((c) => c.ownerPlayerId === me).map((c) => c.id));
  const ownWithout = rows.some(
    (c: CombatantView) => c.kind === "pc" && mine.has(c.entityId ?? "") && c.initiative == null,
  );
  return (
    // Round + hint stay put; the rows scroll inside the window.
    <div
      data-testid="cbt-init"
      data-record-id={enc.id}
      className="flex h-full min-h-0 flex-col gap-2"
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
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {rows.map((c) => {
          const turn = enc.playerTurnCombatantId === c.id;
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
              <span
                className="min-w-0 flex-1 truncate text-sm"
                data-testid="cbt-init-row-name"
                title={c.name}
              >
                {c.name}
              </span>
              {c.kind === "monster" && c.band && (
                <BandBadge band={c.band} testId="cbt-init-row-band" />
              )}
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
    </div>
  );
}

export const playerInitiativeWindow = defineWindow({
  ...initiativeWindowBase,
  clients: ["player"],
  // Player right column, left of `char.sheet` (protocol §24): off the map's centre-left where
  // tokens usually start (CBT §7's top-left covered them). Compact: read-only rows.
  defaultSize: { w: 280, h: 400 },
  minSize: { w: 240, h: 200 },
  defaultPosition: { anchor: "top-right", dx: 332 },
  available: (store) => startedIn(store) !== null,
  component: PlayerInitiativeBody,
  companion: TurnAlertRuntime,
});
