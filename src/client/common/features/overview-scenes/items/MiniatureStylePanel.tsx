// FR-OVW-36: the style panel for selected miniatures, one or many: the label's text half, no dot. The
// canvas is the preview. Unlike a label's, a change isn't remembered: the last style is what the next
// label takes (FR-OVW-28), and a new miniature's name starts from its own default.
import { useEffect } from "react";
import { toastReject, useLive, useMapIntent } from "../../scenes-map/intents";
import { nameStyleOf, type OverviewItemView } from "../item-layout";
import { LabelTextStyleControls, PANEL } from "../LabelStylePanel";
import {
  mixedTextStyle,
  previewStyle,
  restyleItems,
  useStylePreview,
  withStylePreview,
} from "../label-style";

export function SelectedMiniaturesPanel({ items }: { items: readonly OverviewItemView[] }) {
  const live = useLive();
  const send = useMapIntent();
  const preview = useStylePreview((s) => s.preview);
  const ids = items.map((i) => i.id);
  const styles = items.map((i) => nameStyleOf(withStylePreview(i, preview)));
  useEffect(() => () => previewStyle([], null), []);
  return (
    <div data-testid="ovw-miniature-style-panel" data-count={items.length} className={PANEL}>
      <LabelTextStyleControls
        value={mixedTextStyle(styles)}
        disabled={!live}
        onPreview={(p) => previewStyle(ids, p)}
        onCommit={(p) => {
          restyleItems(send, items, p).catch(toastReject);
        }}
      />
    </div>
  );
}
