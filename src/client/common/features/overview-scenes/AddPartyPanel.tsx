// The Add party tool's panel (FR-OVW-20, -31): one press adds who's missing, in the view's centre.
import { Button } from "../../components/ui/button";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { AddHiddenSwitch, useAddHidden } from "./add-hidden";
import { addPartyHere } from "./miniature-actions";
import { useOverviewEditor } from "./overview-editor";

export function AddPartyPanel() {
  const live = useLive();
  const send = useMapIntent();
  const overviewId = useOverviewEditor((s) => s.overviewId);
  return (
    <div
      data-testid="ovw-add-party-panel"
      className="flex w-56 flex-col gap-2 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur"
    >
      <Button
        size="sm"
        variant="outline"
        data-testid="ovw-add-party"
        disabled={!live || !overviewId}
        onClick={() => {
          if (!overviewId) return;
          addPartyHere(send, overviewId, useAddHidden.getState().on).catch(toastReject);
        }}
      >
        Add party
      </Button>
      <AddHiddenSwitch disabled={!live} />
    </div>
  );
}
