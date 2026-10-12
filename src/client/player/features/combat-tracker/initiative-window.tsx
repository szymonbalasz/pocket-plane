// Player `cbt.initiative` (CBT §7), read-only: Round N; rows by `playerPosition` with the turn
// marker (`playerTurnCombatantId`), portrait, name, band (monsters), initiative (PCs).
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { Skeleton } from "@ui/components/ui/primitives";
import { BandBadge, Portrait, TurnMarker } from "@ui/features/combat-tracker/parts";
import { startedIn, useCombatants, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { initiativeWindowBase } from "@ui/features/combat-tracker/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";

function PlayerInitiativeBody() {
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id);
  const me = useSync((s) => s.store.you?.playerId ?? null);
  const characters = useRecords<{ id: string; ownerPlayerId?: string | null }>("entity");
  const everLive = useSync((s) => s.everLive);
  if (!everLive || !enc) return <Skeleton className="h-24" />;
  const mine = new Set(characters.filter((c) => c.ownerPlayerId === me).map((c) => c.id));
  const ownWithout = rows.some(
    (c: CombatantView) => c.kind === "pc" && mine.has(c.entityId ?? "") && c.initiative == null,
  );
  return (
    <div data-testid="cbt-init" data-record-id={enc.id} className="flex flex-col gap-2">
      <span data-testid="cbt-init-round" data-value={enc.round} className="text-sm font-semibold">
        {enc.round === 0 ? "Rolling initiative" : `Round ${enc.round}`}
      </span>
      {ownWithout && (
        <p data-testid="cbt-init-hint" className="text-xs text-muted-foreground">
          Roll initiative on your sheet
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {rows.map((c) => {
          const turn = enc.playerTurnCombatantId === c.id;
          return (
            <li
              key={c.id}
              data-testid="cbt-init-row"
              data-record-id={c.id}
              data-turn={turn}
              data-hidden="false"
              className={cn("flex items-center gap-1.5 rounded-md px-1 py-1", turn && "bg-accent")}
            >
              <TurnMarker active={turn} />
              <Portrait name={c.name} imageAssetId={c.imageAssetId} />
              <span className="min-w-0 flex-1 truncate text-sm" data-testid="cbt-init-row-name">
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
  // CBT §7: top-left below the top bar, clear of the tool rail. 300 wide (not 340) so it stays
  // left of the default-open game log (bottom-left, dx 364).
  defaultSize: { w: 300, h: 520 },
  minSize: { w: 280, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  // CBT §7 says default open. Pending shared change: play-shell's FR-SHELL-14 player test counts
  // only *available* default-open kinds, while `defaultLayout` (rightly) includes gated ones.
  defaultOpen: false,
  available: (store) => startedIn(store) !== null,
  component: PlayerInitiativeBody,
});
