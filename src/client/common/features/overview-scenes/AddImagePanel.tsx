// The Add image tool's panel (FR-OVW-20, -22): the switch first, because the picker is modal. The
// picker itself: `OverviewEditorHost`.
import { Button } from "../../components/ui/button";
import { useLive } from "../scenes-map/intents";
import { AddHiddenSwitch } from "./add-hidden";
import { useOverviewEditor } from "./overview-editor";

export function AddImagePanel() {
  const live = useLive();
  return (
    <div
      data-testid="ovw-add-image-panel"
      className="flex w-56 flex-col gap-2 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur"
    >
      <Button
        size="sm"
        variant="outline"
        data-testid="ovw-add-image-choose"
        disabled={!live}
        onClick={() => useOverviewEditor.setState({ picking: { kind: "place" } })}
      >
        Choose image…
      </Button>
      <AddHiddenSwitch />
    </div>
  );
}
