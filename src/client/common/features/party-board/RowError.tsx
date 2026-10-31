// A rejected action's message on a Party Manager row: the whole text on its own line under the
// row, which grows for it. The row opts in with `has-[[data-slot=party-row-error]]:flex-wrap`, so a
// row with no error stays exactly as it was (FR-KIT-83's one line).
import type { ReactNode } from "react";

export function RowError({ children }: { children: ReactNode }) {
  return (
    <span
      role="alert"
      data-slot="party-row-error"
      className="order-last w-full basis-full break-words text-xs text-destructive"
    >
      {children}
    </span>
  );
}
