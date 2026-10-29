// The DM's View as Select (FR-FOG-17 / -43): "DM", the players, "Party vision"; a spinner while the
// load is in flight. One pick (`useViewAs`) behind two copies: the fog bar's (`fog-view-as`) and,
// #383, the top bar's (`fog-view-as-top`, FR-FOG-60), so the DM checks a player's or the party's
// view without the Fog tool.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import { EyeIcon, Loader2Icon } from "lucide-react";
import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import { useRecords, useSync } from "../../sync/store";
import { useLive } from "../scenes-map/intents";
import { setViewAs, useViewAs, VIEW_AS_DM, VIEW_AS_PARTY_LABEL } from "./view-as";

/** The top-bar item's width, px (FR-SHELL-112 (3): fixed). */
export const VIEW_AS_TOP_W = 150;

export function ViewAsSelect({
  disabled,
  testId,
  className,
}: {
  disabled: boolean;
  testId: string;
  className: string;
}) {
  const players = useRecords<PlayerRecord>("player");
  const sorted = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );
  const playerId = useViewAs((s) => s.playerId);
  const loading = useSync((s) => s.viewAs.loading !== null);
  const value = playerId ?? VIEW_AS_DM;
  return (
    <Select value={value} onValueChange={(v) => setViewAs(v === VIEW_AS_DM ? null : v)}>
      {/* The Tooltip sits on a wrapper: its `data-state` would overwrite the Select's. */}
      <Tooltip content="View as — the scene as that player sees it">
        <span className="inline-flex min-w-0">
          <SelectTrigger
            aria-label="View as"
            data-testid={testId}
            data-value={value}
            data-loading={loading || undefined}
            disabled={disabled}
            className={className}
          >
            {loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <EyeIcon className="size-4" />
            )}
            <SelectValue />
          </SelectTrigger>
        </span>
      </Tooltip>
      <SelectContent>
        <SelectItem value={VIEW_AS_DM} data-testid="fog-view-as-option" data-value={VIEW_AS_DM}>
          DM
        </SelectItem>
        {sorted.map((p) => (
          <SelectItem key={p.id} value={p.id} data-testid="fog-view-as-option" data-value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        <SelectItem
          value={VIEW_AS_PARTY}
          data-testid="fog-view-as-option"
          data-value={VIEW_AS_PARTY}
        >
          {VIEW_AS_PARTY_LABEL}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

/** FR-FOG-60 (#383): the top bar's copy (DM), disabled while not live. */
export function ViewAsTopBarItem() {
  const live = useLive();
  return <ViewAsSelect disabled={!live} testId="fog-view-as-top" className="h-8 w-full min-w-0" />;
}
