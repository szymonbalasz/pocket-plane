// Small combat UI parts for both clients: portrait / initials, health band badge, turn marker.
import type { HealthBand } from "@shared/combat-tracker/schemas";
import { initials } from "@shared/scenes-map/geometry";
import { ChevronRightIcon, SwordsIcon } from "lucide-react";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { AssetImg } from "../assets-pipeline/AssetImg";

export function Portrait({ name, imageAssetId }: { name: string; imageAssetId: string | null }) {
  if (imageAssetId) {
    return (
      <AssetImg id={imageAssetId} file="thumb" alt="" className="size-7 shrink-0 rounded-sm" />
    );
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
      {initials(name)}
    </div>
  );
}

const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  bloodied: "Bloodied",
  down: "Down",
};

const BAND_CLASS: Record<HealthBand, string> = {
  healthy: "border-hp-full/40 text-hp-full",
  bloodied: "border-hp-bloodied/50 text-hp-bloodied",
  down: "border-hp-down/50 text-hp-down",
};

/** `hp.full` / `hp.bloodied` / `hp.down` tokens (visual-direction). */
export function BandBadge({ band, testId }: { band: HealthBand; testId: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-value={band}
      className={cn("px-1.5 text-[11px]", BAND_CLASS[band])}
    >
      {BAND_LABEL[band]}
    </Badge>
  );
}

export function TurnMarker({ active }: { active: boolean }) {
  return (
    <span className="flex w-4 shrink-0 justify-center text-primary" aria-hidden={!active}>
      {active ? <ChevronRightIcon className="size-4" aria-label="Current turn" /> : null}
    </span>
  );
}

export const InitiativeIcon = SwordsIcon;
