// shadcn/ui RadioGroup and Textarea for the Party windows (PARTY §7). Kept in the feature folder:
// no other feature uses them yet (moving them to `components/ui` is a shared change).
import { RadioGroup as R } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof R.Root>) {
  return <R.Root className={cn("grid gap-1.5", className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof R.Item>) {
  return (
    <R.Item
      className={cn(
        "aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary",
        className,
      )}
      {...props}
    >
      <R.Indicator className="flex items-center justify-center">
        <span className="size-2 rounded-full bg-primary" />
      </R.Indicator>
    </R.Item>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
