// FR-CMP-62 / -69: a `rule` entry view's **Open in Rules** (`cmp-rule-open`), both clients.
import { ScrollTextIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useOpenRules } from "./open";

export function OpenInRules({ entryId }: { entryId: string }) {
  const openRules = useOpenRules();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7"
      data-testid="cmp-rule-open"
      onClick={() => openRules(entryId)}
    >
      <ScrollTextIcon className="size-3.5" /> Open in Rules
    </Button>
  );
}
