// shadcn/ui Tabs on radix-ui.
import { Tabs as T } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils";

export function Tabs(props: React.ComponentProps<typeof T.Root>) {
  return <T.Root data-slot="tabs" {...props} />;
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-8 w-fit items-center rounded-md bg-muted p-0.5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-sm px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return (
    <T.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
  );
}
