// A ToggleGroupItem with the shared hover hint (FR-SHELL-30). The Tooltip's trigger writes its own
// `data-state` (closed / delayed-open) onto its child, which would overwrite the item's on / off
// and drop the `data-[state=on]` highlight; the hint therefore sits on a wrapper span. A disabled
// item gets no pointer events, so the wrapper also carries the hint then (`offTestId` names it).
import { Tooltip } from "./overlays";

export function ToggleTip({
  content,
  offTestId,
  children,
}: {
  content: React.ReactNode;
  /** Test ID of the wrapper, e.g. `map-tool-ping-off` while the item is disabled. */
  offTestId?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={content}>
      <span data-slot="toggle-tip" data-testid={offTestId} className="inline-flex">
        {children}
      </span>
    </Tooltip>
  );
}
