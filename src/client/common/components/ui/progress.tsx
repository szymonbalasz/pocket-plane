// shadcn/ui Progress on radix-ui.
import { Progress as P } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

export function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof P.Root> & { value: number }) {
  return (
    <P.Root
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-accent", className)}
      value={value}
      {...props}
    >
      <P.Indicator
        className="h-full bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }}
      />
    </P.Root>
  );
}
