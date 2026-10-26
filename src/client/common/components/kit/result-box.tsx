// Kit part: the Result box (kit-parity FR-KIT-05, glossary "Result box"): a boxed roll total
// coloured by its outcome. A held number (FR-DICE-40) shows "…" with no outcome and no Tooltip, so
// nothing leaks before it lands. Outcome colours are the meaning tokens (`hp.*`, danger), so they
// stay under every theme (FR-THEME-09); a theme styles `data-slot="kit-result"` (ADR-0069).
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Tooltip } from "../ui/overlays";

export const RESULT_OUTCOMES = ["plain", "crit", "fumble", "damage", "heal"] as const;
export type ResultOutcome = (typeof RESULT_OUTCOMES)[number];
export type ResultSize = "sm" | "md" | "lg";

const SIZE: Readonly<Record<ResultSize, string>> = {
  sm: "h-5 min-w-7 px-1 text-xs",
  md: "h-7 min-w-10 px-2 text-lg",
  lg: "h-8 min-w-12 px-2 text-xl",
};

const OUTCOME: Readonly<Record<ResultOutcome, string>> = {
  plain: "",
  crit: "border-hp-full/60 text-hp-full",
  fumble: "text-muted-foreground",
  damage: "border-destructive/60 text-destructive",
  heal: "text-hp-full",
};

export function ResultBox({
  value,
  outcome = "plain",
  held = false,
  size = "md",
  tip,
  className,
  "data-testid": testId = "kit-result",
  ...props
}: {
  value: React.ReactNode;
  outcome?: ResultOutcome;
  /** FR-DICE-40: the number hasn't landed yet. */
  held?: boolean;
  size?: ResultSize;
  /** Hover / focus detail (FR-KIT-45); makes the box focusable. Dropped while held. */
  tip?: React.ReactNode;
  "data-testid"?: string;
} & Omit<React.ComponentProps<"span">, "children">) {
  const shown = held ? undefined : tip;
  const box = (
    <span
      data-testid={testId}
      data-slot="kit-result"
      data-outcome={held ? undefined : outcome}
      data-held={held ? "" : undefined}
      data-size={size}
      tabIndex={shown ? 0 : undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-semibold leading-none tabular-nums",
        SIZE[size],
        held ? "text-muted-foreground" : OUTCOME[outcome],
        className,
      )}
      {...props}
    >
      {held ? "…" : value}
    </span>
  );
  return shown ? <Tooltip content={shown}>{box}</Tooltip> : box;
}
