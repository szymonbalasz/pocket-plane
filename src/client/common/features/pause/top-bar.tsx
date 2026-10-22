// The DM's Pause control as a top-bar item (FR-SHELL-112 (3), -129): a lazy chunk (Popover, image
// picker, Preview) behind a same-width placeholder; the slot is 128 px (the widest state), the
// button inside 96 / 128 / 40 px, at the slot's end next to the identity chip.
import { lazy, Suspense } from "react";

const LazyControl = lazy(() => import("./PauseControl"));

export function PauseTopBarItem() {
  return (
    <Suspense fallback={<div data-testid="ui-pause-loading" className="h-8 w-full" />}>
      <LazyControl />
    </Suspense>
  );
}
