// FR-CHARX-113: a number's breakdown line as Tooltip content; the text is `breakdownText`.
import type { ReactNode } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { useSheet } from "./sheet-context";
import { type BreakdownKey, breakdownText } from "./view-model";

/** `charx-breakdown`, `data-value` = the number's key (e.g. `skill.stealth`). */
export function Breakdown({ okey, text }: { okey: BreakdownKey; text: string }) {
  return (
    <span data-testid="charx-breakdown" data-value={okey}>
      {text}
    </span>
  );
}

/** A number that isn't a roll button (AC, an initiative without its button): its breakdown on hover / focus. */
export function BreakdownTip({ okey, children }: { okey: BreakdownKey; children: ReactNode }) {
  const ctx = useSheet();
  const text = breakdownText(ctx.stats, okey);
  if (!text) return <>{children}</>;
  return (
    <Tooltip content={<Breakdown okey={okey} text={text} />}>
      <span className="inline-flex items-center">{children}</span>
    </Tooltip>
  );
}
