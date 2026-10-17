// FR-FOG-17 / -49 (sprint 4, V10): the fog bar's **Party vision** Switch (`fog-party-vision`,
// `data-state` from the Switch), campaign-wide. Reads the campaign's `fog-settings` record and
// sends `fog.setPartyVision {on}` (the server re-derives the active scene and marks the rest
// stale, one `PartyVisionSet`); the Switch follows the record, so a reject leaves it as it was.
import { FOG_INTENTS, type FogSetPartyVisionInput } from "@shared/fog-of-war/schemas";
import { Switch } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { toastReject, useMapIntent } from "../scenes-map/intents";
import { partyVisionOn } from "./party-view";

export const PARTY_VISION_LABEL = "Party vision";
export const PARTY_VISION_TIP = "Every player sees what any player sees — all scenes";

export function PartyVisionSwitch({ disabled }: { disabled: boolean }) {
  const on = useSync((s) => partyVisionOn(s.store.records));
  const intent = useMapIntent();
  const set = (next: boolean) => {
    const input: FogSetPartyVisionInput = { on: next };
    intent(FOG_INTENTS.setPartyVision, input).catch(toastReject);
  };
  return (
    <Tooltip content={PARTY_VISION_TIP}>
      {/* The Tooltip trigger's `data-state` would overwrite the Switch's: it sits on a wrapper. */}
      <span className="flex items-center gap-1.5 px-1 text-xs">
        <Switch
          id="fog-party-vision"
          data-testid="fog-party-vision"
          checked={on}
          disabled={disabled}
          onCheckedChange={set}
        />
        <label htmlFor="fog-party-vision">{PARTY_VISION_LABEL}</label>
      </span>
    </Tooltip>
  );
}
