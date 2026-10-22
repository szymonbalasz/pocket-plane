// The pause card (FR-SHELL-125, -126; OQ-SHELL-68 A): "Paused", the DM's message, the image
// (`display`, contain, ≤ 60 vh), "Back in m:ss" and the mute toggle (OQ-SHELL-69 A: the only
// thing players can do). Drawn full-screen for players (`PauseOverlay`) and in the DM's Preview.
import type { CampaignPause } from "@shared/campaign-management/table-state";
import { CoffeeIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { countdownText } from "./logic";

/** The client clock, ticking every second while `on` (FR-SHELL-126: no server timer). */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export interface PauseCardProps {
  pause: CampaignPause;
  /** Not `live`: "Reconnecting…" (FR-SHELL-125). */
  reconnecting?: boolean;
  /** The mute toggle; omitted → shown disabled (the DM's Preview). */
  mute?: { muted: boolean; onToggle(): void };
  className?: string;
}

export function PauseCard({ pause, reconnecting = false, mute, className }: PauseCardProps) {
  const now = useNow(pause.backAt !== null);
  const countdown = countdownText(pause.backAt, now);
  const muted = mute?.muted ?? false;
  const MuteIcon = muted ? VolumeXIcon : Volume2Icon;
  return (
    <div
      data-testid="ui-pause-card"
      className={cn("flex w-full max-w-xl flex-col items-center gap-4 text-center", className)}
    >
      <CoffeeIcon aria-hidden className="size-8 text-muted-foreground" />
      <h2 className="text-3xl font-semibold tracking-tight">Paused</h2>
      {pause.message && (
        <p data-testid="ui-pause-message" className="text-lg break-words whitespace-pre-wrap">
          {pause.message}
        </p>
      )}
      {pause.imageAssetId && (
        <div data-testid="ui-pause-image" data-record-id={pause.imageAssetId}>
          <AssetImg
            id={pause.imageAssetId}
            file="display"
            alt="Pause image"
            className="max-h-[60vh] max-w-full rounded-md"
          />
        </div>
      )}
      {countdown && (
        <p
          data-testid="ui-pause-countdown"
          data-back-at={pause.backAt ?? undefined}
          className="text-xl tabular-nums text-muted-foreground"
          aria-live="off"
        >
          {countdown}
        </p>
      )}
      {reconnecting && (
        <p data-testid="ui-pause-reconnecting" role="status" className="text-sm text-warning">
          Reconnecting…
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        data-testid="ui-pause-mute"
        data-state={muted ? "muted" : "on"}
        aria-pressed={muted}
        disabled={!mute}
        onClick={mute?.onToggle}
      >
        <MuteIcon aria-hidden className="size-4" />
        {muted ? "Unmute alert sounds" : "Mute alert sounds"}
      </Button>
    </div>
  );
}
