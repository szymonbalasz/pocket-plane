// shadcn/ui ScrollArea on radix-ui.
import { ScrollArea as SA } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SA.Root>) {
  return (
    <SA.Root className={cn("relative overflow-hidden", className)} {...props}>
      <SA.Viewport className="size-full rounded-[inherit]">{children}</SA.Viewport>
      <ScrollBar />
      <SA.Corner />
    </SA.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof SA.ScrollAreaScrollbar>) {
  return (
    <SA.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <SA.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </SA.ScrollAreaScrollbar>
  );
}
