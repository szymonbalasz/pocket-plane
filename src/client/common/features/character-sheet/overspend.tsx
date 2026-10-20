// Feature uses below zero (FR-CHARX-58; MOD FR-MOD-59): the overspent Tooltip on a row's count
// ("−1 / 3"; FR-MOD-68: the minus once, no "−1" Badge beside it), and the small Popover that asks
// before spending a use the row doesn't have. Used by the Features tab's pips and MOD's Toggles
// block (the Rage switch). The server allows the spend; this only asks.

import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { overspendAsk, overspentTip } from "./view-model";

/**
 * FR-MOD-68 (BL-48 "−1 / 3 −1"): a row that shows the count itself ("−1 / 3") draws no Badge; the
 * Tooltip ("1 use more than the maximum — check with your DM") goes on its count. At ≥ 0 the
 * children alone.
 */
export function OverspentTip({ left, children }: { left: number; children: ReactNode }) {
  if (left >= 0) return <>{children}</>;
  return <Tooltip content={overspentTip(left)}>{children}</Tooltip>;
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
