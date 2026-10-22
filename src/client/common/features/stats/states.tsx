// Stats states (FR-STATS-24, -50), shared by the Stats tabs and the Trophies tab: skeleton rows
// while the first answer loads, "Couldn't load stats" + Retry, an empty line.
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/primitives";

export function SkeletonRows() {
  return (
    <div data-testid="stats-loading" className="flex flex-col gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function LoadError({ retry }: { retry(): void }) {
  return (
    <div data-testid="stats-error" className="flex items-center gap-2 text-sm text-destructive">
      Couldn't load stats
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2"
        data-testid="stats-retry"
        onClick={retry}
      >
        Retry
      </Button>
    </div>
  );
}

export const Empty = ({ text }: { text: string }) => (
  <p data-testid="stats-empty" className="text-sm text-muted-foreground">
    {text}
  </p>
);
