// Campaign options (FR-CAMP-42, OQ-CAMP-33 A): the Players window's "Options" Button opens a
// Dialog "Campaign options — ‹campaign›" with one row per registered feature (label, description,
// Switch). Turning a feature on sends `camp.setFeature` at once; turning it off asks once in the
// row (`offConfirm` replaces the description, "Turn off" / "Cancel"). DM only; disabled unless
// `live`. The server's resync after a switch keeps this Dialog open (FR-CAMP-40).
import { FEATURES, type FeatureDef, hasFeature } from "@shared/campaign-management/features";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { Button } from "@ui/components/ui/button";
import { Switch } from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ui/components/ui/overlays";
import { intentErrorText } from "@ui/features/character-sheet/routing";
import { useSync } from "@ui/sync/store";
import { Settings2Icon } from "lucide-react";
import { useState } from "react";

export const SET_FEATURE_INTENT = "camp.setFeature";

/** The DM store's campaign row (the DM holds only the active one). */
function useCampaign(): CampaignRecord | undefined {
  return useSync((s) => {
    const byId = s.store.records.campaign as Record<string, CampaignRecord> | undefined;
    const id = s.store.you?.campaignId;
    return (id ? byId?.[id] : undefined) ?? (byId ? Object.values(byId)[0] : undefined);
  });
}

/** A Switch flip: on sends at once; off asks first when the feature has an `offConfirm`. */
export const switchAction = (def: FeatureDef, next: boolean): "on" | "ask" | "off" =>
  next ? "on" : def.offConfirm ? "ask" : "off";

function FeatureRow({ def, on, live }: { def: FeatureDef; on: boolean; live: boolean }) {
  const connection = useSync((s) => s.connection);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || !live;

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await connection.sendIntent(SET_FEATURE_INTENT, { feature: def.key, on: next });
      setAsking(false);
    } catch (err) {
      setError(intentErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const id = `camp-feature-${def.key}`;
  return (
    <div
      data-testid="camp-feature"
      data-value={def.key}
      data-state={on ? "on" : "off"}
      className="flex items-start gap-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-semibold">
          {def.label}
        </label>
        {asking ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm">{def.offConfirm}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7"
                data-testid="camp-feature-confirm"
                disabled={disabled}
                onClick={() => void set(false)}
              >
                Turn off
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                data-testid="camp-feature-cancel"
                onClick={() => setAsking(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{def.description}</p>
        )}
        {error && (
          <p data-testid="camp-feature-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Switch
        id={id}
        data-testid="camp-feature-switch"
        data-value={def.key}
        checked={on}
        disabled={disabled}
        onCheckedChange={(next) => {
          const act = switchAction(def, next);
          if (act === "ask") setAsking(true);
          else void set(act === "on");
        }}
      />
    </div>
  );
}

/** FR-CAMP-42: one row per registered feature, `on` from the campaign row. */
export function FeatureRows() {
  const campaign = useCampaign();
  const live = useSync((s) => s.state === "live");
  return (
    <div className="flex flex-col gap-3">
      {FEATURES.map((def) => (
        <FeatureRow
          key={def.key}
          def={def}
          on={hasFeature(campaign?.features, def.key)}
          live={live}
        />
      ))}
    </div>
  );
}

/** FR-CAMP-42: the "Options" Button and its Dialog. */
export function CampaignOptions() {
  const name = useCampaign()?.name ?? "";
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-4 gap-1 px-1 text-xs"
          data-testid="camp-options-open"
        >
          <Settings2Icon className="size-3" /> Options
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="camp-options" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Campaign options — {name}</DialogTitle>
          <DialogDescription>Optional features for this campaign only</DialogDescription>
        </DialogHeader>
        <FeatureRows />
      </DialogContent>
    </Dialog>
  );
}
