// Printed sheet parts (CHARX §6.2): the labelled box (FR-CHARX-105), the Armor Class shield
// (FR-CHARX-106) and the d20 glyph of skill buttons (FR-CHARX-110). Default draws them with
// today's tokens; themes style the `data-slot` names (FR-CHARX-119), no theme logic here. Sizes
// follow the kit's "Character sheet" section (K11): 12-px labels, 26-px values (34 px wide).
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useSheetScope } from "./sheet-context";

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
  | "features"
  | "uses";

/** Small-caps box label on the box's top edge (the kit's 12-px label line). */
export const BOX_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * FR-CHARX-105: a labelled box. `aside` sits on the label line; `list` boxes (Skills, Attacks,
 * …) put the label left and their rows full width.
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
  const scope = useSheetScope();
  return (
    <div
      data-testid="charx-box"
      data-value={box}
      data-scope={scope}
      data-slot="sheet-box"
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-card",
        list ? "gap-0.5 px-2 py-1.5" : "items-center px-1 pt-[5px] pb-1.5 text-center",
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

/** The large value inside a stat box: the kit's 26 px, 34 px once the sheet is wide. */
export const BOX_VALUE =
  "text-[26px] font-bold tabular-nums leading-[1.15] @min-[560px]/sheet:text-[34px]";

/** A value's unit ("ft", "/ 44"): small and muted beside the large value (kit `.unit`). */
export const BOX_UNIT = "text-[0.55em] font-medium text-muted-foreground";

/**
 * A label that reads short in the narrow sheet and in full once it is wide (kit "AC" / "Armor
 * Class"); both are in the markup, the sheet's container query shows one.
 */
export function WideLabel({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="@min-[560px]/sheet:hidden">{short}</span>
      <span className="hidden @min-[560px]/sheet:inline">{full}</span>
    </>
  );
}

/**
 * FR-CHARX-106: the Armor Class shield outline (inline SVG, `currentColor`): the kit's outer rule
 * and a fainter inner rule.
 */
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
      <path
        d="M50 11L87 22V52C87 76 70 91 50 100 30 91 13 76 13 52V22Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** FR-CHARX-110: the d20 glyph on a skill's roll button (the kit's 13 px). */
export function D20Glyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-[13px] shrink-0", className)}>
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
