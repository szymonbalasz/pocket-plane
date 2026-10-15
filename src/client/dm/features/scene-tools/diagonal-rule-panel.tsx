// The DM Ruler tool's panel (SCN §7, FR-SCN-29): "Diagonals" 5/10/5 · 5 ft → `scn.setDiagonalRule`.
// Shows the server's rule (the store's `map-settings` row, no row = 5/10/5); no optimistic value.
// Off while not live (FR-SCN-34).
import { SCN_INTENTS } from "@shared/scene-tools/schemas";
import { ToggleGroup, ToggleGroupItem } from "@ui/components/ui/menus";
import { DIAGONAL_OPTIONS, diagonalRuleIn } from "@ui/features/scene-tools/diagonal-rule";
import { toastReject, useLive, useMapIntent } from "@ui/features/scenes-map/intents";
import { useSync } from "@ui/sync/store";

export function DiagonalRulePanel() {
  const rule = useSync((s) => diagonalRuleIn(s.store.records));
  const live = useLive();
  const send = useMapIntent();
  return (
    <div
      data-testid="scn-ruler-panel"
      className="flex items-center gap-2 rounded-md border bg-background/90 p-1 pl-2 shadow-sm backdrop-blur"
    >
      <span className="text-xs text-muted-foreground" id="scn-diagonal-rule-label">
        Diagonals
      </span>
      <ToggleGroup
        type="single"
        value={rule}
        onValueChange={(v) => {
          if (!v || v === rule) return;
          send(SCN_INTENTS.setDiagonalRule, { rule: v }).catch(toastReject);
        }}
        aria-labelledby="scn-diagonal-rule-label"
        data-testid="scn-diagonal-rule"
        data-value={rule}
        disabled={!live}
      >
        {DIAGONAL_OPTIONS.map((o) => (
          <ToggleGroupItem
            key={o.rule}
            value={o.rule}
            aria-label={`${o.label}: ${o.hint}`}
            data-testid={`scn-diagonal-rule-${o.rule}`}
            className="w-auto px-2 text-xs"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
