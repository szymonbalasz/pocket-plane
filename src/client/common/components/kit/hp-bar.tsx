// Kit part: the HP bar (kit-parity FR-KIT-05): a thin bar plus "cur / max" when the numbers are
// known, else the health band word alone (a monster for players: never a bar length, FR-KIT-26).
// Colours are the meaning tokens `hp.*`, not themed (FR-THEME-09); a theme styles the track
// through `data-slot="kit-hpbar"` (ADR-0069).
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
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <span
        aria-hidden
        data-slot="kit-hpbar-track"
        className="h-[5px] min-w-6 flex-1 overflow-hidden rounded-[1px] bg-muted"
      >
        <span
          data-slot="kit-hpbar-fill"
          className={cn("block h-full", FILL[b])}
          style={{ width: `${hpFill(cur, max)}%` }}
        />
      </span>
      {numbers && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {cur} / {max}
        </span>
      )}
    </span>
  );
}
