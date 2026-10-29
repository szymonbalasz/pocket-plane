// An icon-only control's hover hint (FR-SHELL-30 / -84): the shared Tooltip, on a wrapper span
// while the control is disabled (a disabled button gets no pointer events or focus).
import type * as React from "react";
import { Tooltip } from "./overlays";

export function Tip({
  content,
  off = false,
  children,
}: {
  content: React.ReactNode;
  /** The control is disabled: the hint moves to a wrapper. */
  off?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={content}>
      {off ? <span className="inline-flex">{children}</span> : children}
    </Tooltip>
  );
}
