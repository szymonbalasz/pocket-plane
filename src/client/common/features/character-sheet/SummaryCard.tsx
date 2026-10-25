// Summary card of another player's PC (FR-CHARX-32): portrait, name, owner, "Level N Class",
// species, Down / death state; with gems on, the gem counts under the level (FR-CHARX-73).
// Nothing else; no sections (CHARX §7.1).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { ReactNode } from "react";
import { Badge, Card } from "../../components/ui/primitives";
import { GemCountsRow } from "../gems/GemCounts";
import { Portrait } from "./SheetView";
import { type SummaryInput, summaryCard } from "./view-model";

export function SummaryCard({
  e,
  players,
  picker,
}: {
  e: SummaryInput;
  players: readonly PlayerRecord[];
  picker: ReactNode;
}) {
  const v = summaryCard(e, players);
  return (
    <Card
      data-testid="charx-summary"
      data-record-id={e.id}
      className="flex flex-col gap-2 border-0 bg-transparent p-1 shadow-none"
    >
      <div className="flex items-start gap-3">
        <Portrait id={e.portraitAssetId} name={e.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span data-testid="charx-summary-name" className="truncate font-semibold">
            {v.name}
          </span>
          {v.level && (
            <span data-testid="charx-summary-level" className="text-xs text-muted-foreground">
              {v.level}
            </span>
          )}
          <GemCountsRow characterId={e.id} testId="charx-summary-gems" />
          {v.species && (
            <span data-testid="charx-summary-species" className="text-xs text-muted-foreground">
              {v.species}
            </span>
          )}
          {v.owner && (
            <span data-testid="charx-summary-owner" className="text-xs text-muted-foreground">
              Played by {v.owner}
            </span>
          )}
          {v.status && (
            <Badge
              data-testid="charx-summary-status"
              className="w-fit bg-hp-down text-hp-down-foreground"
            >
              {v.status}
            </Badge>
          )}
        </div>
        {picker}
      </div>
    </Card>
  );
}
