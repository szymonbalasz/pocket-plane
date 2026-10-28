// Gem icons and the read-only counts row (FR-GEM-35, OQ-GEM-03 B): lucide sparkles / coins /
// swords / eye / zap in `text.primary`, the name in a Tooltip and the `aria-label`. The row is
// the summary card's (FR-CHARX-73) and the Players window's (FR-CAMP-43); the sheet's own block
// is `GemBlock`. Counts above 5 look like any other (FR-GEM-08).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import type { GemKind } from "@shared/gems/schemas";
import { CoinsIcon, EyeIcon, SparklesIcon, SwordsIcon, ZapIcon } from "lucide-react";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { isFeatureOn } from "../campaign-management/use-feature";
import { countsOf, GEM_TIP, type GemChip, gemChips, gemsRow } from "./model";

const ICONS = {
  inspiration: SparklesIcon,
  fortune: CoinsIcon,
  combat: SwordsIcon,
  divine: EyeIcon,
  action: ZapIcon,
} satisfies Record<GemKind, unknown>;

export function GemIcon({ gem, className }: { gem: GemKind; className?: string }) {
  const Icon = ICONS[gem];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0 text-foreground", className)} />;
}

/** One icon + number, read-only; zeros muted. */
export function GemCountChip({
  chip,
  testId,
  recordId,
  className,
}: {
  chip: GemChip;
  testId: string;
  recordId?: string;
  className?: string;
}) {
  return (
    <Tooltip content={GEM_TIP[chip.gem]}>
      <span
        data-testid={testId}
        data-record-id={recordId}
        data-value={chip.gem}
        data-count={chip.count}
        role="img"
        aria-label={chip.label}
        className={cn(
          "inline-flex items-center gap-0.5 tabular-nums",
          chip.muted && "text-muted-foreground opacity-60",
          className,
        )}
      >
        <GemIcon gem={chip.gem} className="size-3" />
        {chip.count}
      </span>
    </Tooltip>
  );
}

/**
 * The five counts of a character in one compact row, or nothing while gems are off. `testId`
 * names the row; each count is `gem-summary-count` (+ `data-value` = gem, `data-count`).
 */
export function GemCountsRow({
  characterId,
  testId,
  className,
}: {
  characterId: string;
  testId: string;
  className?: string;
}) {
  const on = useSync((s) => isFeatureOn(s.store, GEMS_FEATURE));
  const row = useSync((s) => gemsRow(s.store, characterId));
  if (!on) return null;
  return (
    <span
      data-testid={testId}
      data-record-id={characterId}
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
    >
      {gemChips(countsOf(row)).map((c) => (
        <GemCountChip key={c.gem} chip={c} testId="gem-summary-count" recordId={characterId} />
      ))}
    </span>
  );
}

/**
 * FR-CAMP-43: the Players window's party line tail, the counts (`camp-player-char-gems`). BL-138:
 * spaced like the line's stats, no "·" before them (K10).
 */
export function PartyLineGems({ characterId }: { characterId: string }) {
  const on = useSync((s) => isFeatureOn(s.store, GEMS_FEATURE));
  if (!on) return null;
  return <GemCountsRow characterId={characterId} testId="camp-player-char-gems" />;
}
