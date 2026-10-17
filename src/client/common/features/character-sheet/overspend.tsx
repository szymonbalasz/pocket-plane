// Feature uses below zero (FR-CHARX-58; MOD FR-MOD-59): the "−1" Badge with its Tooltip, and the
// small Popover that asks before spending a use the row doesn't have. Used by the Features tab's
// pips and MOD's Toggles block (the Rage switch). The server allows the spend; this only asks.

import { leftText } from "@shared/character-sheet/counters";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { overspendAsk, overspentTip } from "./view-model";

/** "−1" in `hp.down` with "1 use more than the maximum — check with your DM"; none at ≥ 0. */
export function OverspentBadge({ left, testId }: { left: number; testId: string }) {
  if (left >= 0) return null;
  return (
    <Tooltip content={overspentTip(left)}>
      <Badge
        data-testid={testId}
        data-value={left}
        className="border-transparent bg-hp-down px-1 py-0 text-[10px] text-white"
      >
        {leftText(left)}
      </Badge>
    </Tooltip>
  );
}

/**
 * The ask anchored on `children`: "No Rage uses left (0 / 3). Rage anyway? → −1 / 3" with
 * `‹verb› anyway` / Cancel; at the floor only the reset hint and Close.
 */
export function OverspendPopover({
  open,
  onOpenChange,
  name,
  left,
  max,
  verb,
  testId,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  name: string;
  left: number;
  max: number;
  verb: string;
  testId: string;
  disabled?: boolean;
  onConfirm(): void;
  children: ReactNode;
}) {
  const ask = overspendAsk(name, left, max, verb);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        data-testid={testId}
        data-state={ask.confirm ? "ask" : "floor"}
        className="flex w-60 flex-col gap-2 p-2 text-xs"
      >
        <span>{ask.text}</span>
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            data-testid={`${testId}-cancel`}
            onClick={() => onOpenChange(false)}
          >
            {ask.confirm ? "Cancel" : "Close"}
          </Button>
          {ask.confirm && (
            <Button
              size="sm"
              data-testid={`${testId}-confirm`}
              disabled={disabled}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {ask.confirm}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
