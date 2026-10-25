// Printed sheet parts (CHARX §6.2): the labelled box (FR-CHARX-105), the Armor Class shield
// (FR-CHARX-106) and the d20 glyph of skill buttons (FR-CHARX-110). Default draws them with
// today's tokens; themes style the `data-slot` names (FR-CHARX-119), no theme logic here.
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** FR-CHARX-117: `charx-box` `data-value` keys. */
export type BoxKey =
  | "ac"
  | "hp"
  | "speed"
  | "init"
  | "prof"
  | "vitals"
  | "skills"
  | "passives"
  | "attacks"
  | "spells"
  | "features";

/** Small-caps box label on the box's top edge. */
export const BOX_LABEL = "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * FR-CHARX-105: a labelled box. `aside` sits on the label line (DM public switches); `list`
 * boxes (Skills, Attacks, …) put the label left and their rows full width.
 */
export function Box({
  box,
  label,
  aside,
  list = false,
  className,
  children,
}: {
  box: BoxKey;
  label?: ReactNode;
  aside?: ReactNode;
  list?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="charx-box"
      data-value={box}
      data-slot="sheet-box"
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-card",
        list ? "gap-0.5 px-2 py-1.5" : "items-center px-1.5 pt-1 pb-1.5 text-center",
        className,
      )}
    >
      {(label || aside) && (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2 self-stretch",
            list ? "justify-between" : "justify-center",
          )}
        >
          {label && <span className={cn(BOX_LABEL, "truncate")}>{label}</span>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/** The large value inside a stat box. */
export const BOX_VALUE = "text-lg font-semibold tabular-nums leading-tight";

/** FR-CHARX-106: the Armor Class shield outline (inline SVG, `currentColor`). */
export function ShieldOutline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 112" aria-hidden="true" className={className}>
      <path
        d="M50 4L94 17V52C94 81 73 98 50 108 27 98 6 81 6 52V17Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** FR-CHARX-110: the d20 glyph on a skill's roll button. */
export function D20Glyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-3 shrink-0", className)}>
      <path
        d="M12 2.5l8.5 5v9l-8.5 5-8.5-5v-9zM12 7l5 8.5H7zM12 2.5V7M3.5 7.5L7 15.5M20.5 7.5L17 15.5M7 15.5l5 6 5-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
