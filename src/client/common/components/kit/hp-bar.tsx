// Kit part: the HP bar (kit-parity FR-KIT-05): a thin bar plus "cur / max" when the numbers are
// known, else the health band word alone (a monster for players: never a bar length, FR-KIT-26).
// Colours are the meaning tokens `hp.*`, not themed (FR-THEME-09); a theme styles the track
// through `data-slot="kit-hpbar"` (ADR-0069). K9: `track="fixed"` draws the kit's 120-px track
// (Initiative), so bars line up row to row; it shrinks only when the line can't hold it.
import { healthBand } from "@shared/combat-tracker/rules";
import type { HealthBand } from "@shared/entities/schemas";
import type * as React from "react";
import { cn } from "../../lib/utils";

export const BAND_WORD: Readonly<Record<HealthBand, string>> = {
  healthy: "Healthy",
  bloodied: "Bloodied",
  down: "Down",
};

const FILL: Readonly<Record<HealthBand, string>> = {
  healthy: "bg-hp-full",
  bloodied: "bg-hp-bloodied",
  down: "bg-hp-down",
};

const WORD: Readonly<Record<HealthBand, string>> = {
  healthy: "text-hp-full",
  bloodied: "text-hp-bloodied",
  down: "text-hp-down",
};

/** Bar fill in % of max, 0–100. */
export function hpFill(cur: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, cur / max)) * 100);
}

/** Numbers when both are known (max > 0), else the band alone, else nothing. */
/** The kit's fixed track width (`.bar` in the 340-px Initiative), px. */
export const HP_TRACK_PX = 120;

export function hpBarMode(
  cur: number | null | undefined,
  max: number | null | undefined,
  band: HealthBand | null | undefined,
): "bar" | "band" | null {
  if (typeof cur === "number" && typeof max === "number" && max > 0) return "bar";
  return band ? "band" : null;
}

export function HpBar({
  cur,
  max,
  band,
  numbers = true,
  track = "fill",
  className,
  "data-testid": testId = "kit-hpbar",
  ...props
}: {
  cur?: number | null;
  max?: number | null;
  /** The band the caller holds (FR-CBT-26); derived from the numbers when absent. */
  band?: HealthBand | null;
  /** Show "cur / max" after the bar. */
  numbers?: boolean;
  /** `fill` takes the line's room; `fixed` = `HP_TRACK_PX` (shrinks only when the line is narrower). */
  track?: "fill" | "fixed";
  "data-testid"?: string;
} & Omit<React.ComponentProps<"span">, "children">) {
  const mode = hpBarMode(cur, max, band);
  if (mode === null) return null;
  if (mode === "band" || cur == null || max == null) {
    const b = band as HealthBand;
    return (
      <span
        data-testid={testId}
        data-slot="kit-hpbar"
        data-band={b}
        className={cn("truncate text-xs font-medium", WORD[b], className)}
        {...props}
      >
        {BAND_WORD[b]}
      </span>
    );
  }
  const b = band ?? healthBand(cur, max);
  return (
    <span
      data-testid={testId}
      data-slot="kit-hpbar"
      data-band={b}
      data-track={track}
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <span
        aria-hidden
        data-slot="kit-hpbar-track"
        className={cn(
          "h-[5px] min-w-6 overflow-hidden rounded-[1px] bg-muted",
          track === "fixed" ? "shrink grow-0 basis-[120px]" : "flex-1",
        )}
      >
        <span
          data-slot="kit-hpbar-fill"
          className={cn("block h-full", FILL[b])}
          style={{ width: `${hpFill(cur, max)}%` }}
        />
      </span>
      {numbers && (
        <span
          className={cn(
            "shrink-0 text-xs text-muted-foreground tabular-nums",
            // Fixed: "cur / max" keeps a column (up to "38 / 44"), so the next part lines up too.
            track === "fixed" && "min-w-[7ch]",
          )}
        >
          {cur} / {max}
        </span>
      )}
    </span>
  );
}
