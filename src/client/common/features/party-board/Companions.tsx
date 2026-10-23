// The companion row form (FR-PARTY-42, sprint 6), both clients; since sprint 9 listed under each
// owner PC in the Party status tab (FR-PARTY-61, `StatusTab.tsx`; the Companions tab is gone).
// Row: portrait / initials, name, turn mode icon, "In combat", the marks the tab adds (turn,
// eye-off, condition icons); HP "45 / 59" + bar for the DM and the owner (the combatant's in a
// fight), a band for others; DM: the base name; Card (DM, owner) opens the companion card. The
// DM's New pet… and row menu come from the DM client (`dm`, FR-PARTY-62).
import { IdCardIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import {
  COMPANION_CARD_KIND,
  useOpenCompanionCard,
} from "../combat-tracker/companion-card-request";
import { ModeIcon } from "../combat-tracker/companions";
import { BandBadge, Portrait } from "../combat-tracker/parts";
import { useRegistry } from "../play-shell/ShellContext";
import { type CompanionRow, hpValue } from "./logic";

/** The DM client's parts (FR-PARTY-43, -62): header New pet…, the row menu. */
export interface CompanionsDmParts {
  header: ComponentType<{ disabled: boolean }>;
  menu: ComponentType<{ row: CompanionRow; disabled: boolean }>;
}

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
      className="h-6 px-1.5 text-xs"
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
  const pct = row.hp.max > 0 ? Math.min(100, Math.round((100 * row.hp.current) / row.hp.max)) : 0;
  return (
    <div className="flex min-w-16 shrink-0 flex-col items-end gap-0.5">
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

/** One companion line (FR-PARTY-42 form); `marks` sit after the badges (FR-PARTY-61). */
export function CompanionLine({
  row,
  ownerName,
  base,
  dm,
  live,
  marks,
}: {
  row: CompanionRow;
  ownerName: string;
  base: string | null;
  dm?: CompanionsDmParts;
  live: boolean;
  marks?: ReactNode;
}) {
  return (
    <li
      data-testid="party-companion-row"
      data-record-id={row.id}
      data-in-combat={row.inCombat}
      className="flex items-center gap-1.5 py-0.5 pl-4 text-muted-foreground"
    >
      <Portrait name={row.name} imageAssetId={row.portraitAssetId} />
      {/* FR-PARTY-46: badges wrap, the name is never cut. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="break-words" data-testid="party-companion-name">
          {row.name}
        </span>
        {/* FR-PARTY-42: FR-CBT-118's icon; the Tooltip names the mode. */}
        {row.turnMode && (
          <ModeIcon
            id={row.id}
            mode={row.turnMode}
            ownerName={ownerName}
            testId="party-companion-mode-icon"
          />
        )}
        {row.inCombat && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
            In combat
          </Badge>
        )}
        {base && (
          <span className="text-[11px] [overflow-wrap:anywhere]" data-testid="party-companion-base">
            {base}
          </span>
        )}
        {marks}
      </div>
      <span className={cn("flex shrink-0 items-center gap-1.5", !live && "opacity-70")}>
        <Health row={row} />
        {row.card && <CardButton row={row} />}
        {dm && <dm.menu row={row} disabled={!live} />}
      </span>
    </li>
  );
}
