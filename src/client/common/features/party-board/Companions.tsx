// `party.board` **Companions** tab, both clients (FR-PARTY-41–46, sprint 6): every pet the viewer
// receives (entities' FR-ENT-37: DM and owner every pet, other players present pets only),
// grouped by owner PC (header: PC name + owner player's colour dot). Row: portrait / initials,
// name, turn mode icon, "In combat"; HP "45 / 59" + bar for the DM and the owner (the combatant's
// in a fight), a band for others; Card (DM, owner) opens the companion card. The DM's New pet… and
// row menu come from the DM client (`dm`). Reads `entity` / `combatant` rows only (FR-PARTY-45).
import type { TurnMode } from "@shared/entities/schemas";
import { CornerDownRightIcon, DicesIcon, IdCardIcon, LinkIcon } from "lucide-react";
import { type ComponentType, useMemo } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import {
  COMPANION_CARD_KIND,
  useOpenCompanionCard,
} from "../combat-tracker/companion-card-request";
import { BandBadge, Portrait } from "../combat-tracker/parts";
import { useDefinitions } from "../compendium/definitions";
import { useRegistry } from "../play-shell/ShellContext";
import {
  type CompanionGroup,
  type CompanionRow,
  companionGroups,
  EMPTY_COMPANIONS,
  EMPTY_COMPANIONS_PLAYER,
  fightRunning,
  hpValue,
  SUMMONS_FOOTER,
} from "./logic";

/** The DM client's parts (FR-PARTY-43): header New pet…, the row menu. */
export interface CompanionsDmParts {
  header: ComponentType<{ disabled: boolean }>;
  menu: ComponentType<{ row: CompanionRow; disabled: boolean }>;
}

/** FR-PARTY-42: the turn mode as FR-CBT-118's icon; Tooltip names the mode. */
const MODE: Record<TurnMode, { icon: typeof LinkIcon; label: string }> = {
  "after-owner": { icon: CornerDownRightIcon, label: "After the owner" },
  "in-owner-turn": { icon: LinkIcon, label: "In the owner's turn" },
  own: { icon: DicesIcon, label: "Own initiative" },
};

const HP_BAR = { healthy: "bg-hp-full", bloodied: "bg-hp-bloodied", down: "bg-hp-down" } as const;

/** FR-PARTY-42 / FR-CHARX-59: Card, while the companion card window is registered. */
function CardButton({ row }: { row: CompanionRow }) {
  const registered = useRegistry().get(COMPANION_CARD_KIND) !== undefined;
  const openCard = useOpenCompanionCard();
  if (!registered) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2"
      data-testid="party-companion-card"
      data-record-id={row.id}
      onClick={() => openCard(row.id)}
    >
      <IdCardIcon className="size-3.5" />
      Card
    </Button>
  );
}

function Health({ row }: { row: CompanionRow }) {
  if (!row.hp) return <BandBadge band={row.band} testId="party-companion-band" />;
  const pct = row.hp.max > 0 ? Math.round((100 * row.hp.current) / row.hp.max) : 0;
  return (
    <div className="flex min-w-16 flex-col items-end gap-0.5">
      <span
        data-testid="party-companion-hp"
        data-value={hpValue(row.hp)}
        className="whitespace-nowrap text-xs tabular-nums"
      >
        {row.hp.current} / {row.hp.max}
      </span>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-accent" aria-hidden>
        <div className={cn("h-full", HP_BAR[row.band])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({
  row,
  base,
  dm,
  live,
}: {
  row: CompanionRow;
  base: string | null;
  dm?: CompanionsDmParts;
  live: boolean;
}) {
  const mode = row.turnMode ? MODE[row.turnMode] : null;
  return (
    <li
      data-testid="party-companion-row"
      data-record-id={row.id}
      data-in-combat={row.inCombat}
      className="flex items-center gap-2 py-1"
    >
      <Portrait name={row.name} imageAssetId={row.portraitAssetId} />
      <div className="min-w-0 flex-1">
        {/* FR-PARTY-46: badges wrap, the name is never cut. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="break-words font-medium" data-testid="party-companion-name">
            {row.name}
          </span>
          {mode && (
            <Tooltip content={mode.label}>
              <span
                className="text-muted-foreground"
                data-testid="party-companion-mode-icon"
                data-value={row.turnMode}
              >
                <mode.icon className="size-3.5" aria-label={mode.label} />
              </span>
            </Tooltip>
          )}
          {row.inCombat && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              In combat
            </Badge>
          )}
        </div>
        {base && (
          <div
            className="truncate text-xs text-muted-foreground"
            data-testid="party-companion-base"
          >
            {base}
          </div>
        )}
      </div>
      <Health row={row} />
      {row.card && <CardButton row={row} />}
      {dm && <dm.menu row={row} disabled={!live} />}
    </li>
  );
}

function Group({
  g,
  bases,
  dm,
  live,
}: {
  g: CompanionGroup;
  bases: ReadonlyMap<string, string>;
  dm?: CompanionsDmParts;
  live: boolean;
}) {
  const colorOf = useColorOf();
  const color = colorOf({ role: "player", playerId: g.playerId });
  return (
    <section data-testid="party-companion-group" data-record-id={g.characterId}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <span
          className="size-2 shrink-0 rounded-full"
          style={color ? { backgroundColor: color } : undefined}
          aria-hidden
        />
        {g.characterName}
      </h3>
      <ul className="divide-y">
        {g.rows.map((r) => (
          <Row
            key={r.id}
            row={r}
            base={r.baseId ? (bases.get(r.baseId) ?? null) : null}
            dm={dm}
            live={live}
          />
        ))}
      </ul>
    </section>
  );
}

export function CompanionsTab({ dm }: { dm?: CompanionsDmParts }) {
  const entities = useRecords<unknown>("entity");
  const combatants = useRecords<unknown>("combatant");
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const viewer = useMemo(
    () => ({ role: you?.role ?? "player", playerId: you?.playerId ?? null }) as const,
    [you],
  );
  const groups = useMemo(
    () => companionGroups(entities, combatants, viewer),
    [entities, combatants, viewer],
  );
  // DM: the bases' names ("Owlbear", muted); imported ones load on demand.
  const baseIds = useMemo(
    () => [...new Set(groups.flatMap((g) => g.rows.flatMap((r) => (r.baseId ? [r.baseId] : []))))],
    [groups],
  );
  const defs = useDefinitions(viewer.role === "dm" ? baseIds : []).byId;
  const bases = useMemo(() => new Map([...defs.values()].map((d) => [d.id, d.name])), [defs]);
  const running = fightRunning(combatants);
  return (
    <div data-testid="party-companions" className="flex h-full min-h-0 flex-col gap-2">
      {dm && (
        <div>
          <dm.header disabled={!live} />
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {groups.length === 0 ? (
          <p
            data-testid="party-companions-empty"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            {viewer.role === "dm" ? EMPTY_COMPANIONS : EMPTY_COMPANIONS_PLAYER}
          </p>
        ) : (
          <div className="flex flex-col gap-3 pr-2">
            {groups.map((g) => (
              <Group key={g.characterId} g={g} bases={bases} dm={dm} live={live} />
            ))}
          </div>
        )}
      </ScrollArea>
      {running && (
        <p data-testid="party-companions-footer" className="text-xs text-muted-foreground">
          {SUMMONS_FOOTER}
        </p>
      )}
    </div>
  );
}
