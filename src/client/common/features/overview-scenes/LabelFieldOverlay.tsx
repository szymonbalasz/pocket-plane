// FR-OVW-25, -26: the DOM input over the canvas at the label's place, following the camera. Focus
// lands after the press's own: a browser focuses the canvas once the mousedown has run its handlers.
import { LABEL_TEXT_MAX } from "@shared/overview-scenes/schemas";
import { useEffect, useRef } from "react";
import { Input } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { useLive, useMapIntent } from "../scenes-map/intents";
import { useAddHidden } from "./add-hidden";
import type { OverviewView } from "./item-edit";
import { lastLabelStyle } from "./label-style";
import {
  cleanLabelText,
  closeLabelField,
  setLabelFieldText,
  submitLabelField,
  useLabelField,
} from "./label-tool";
import { useOverviewCanvas } from "./overview-canvas-context";
import { useOverviewEditor } from "./overview-editor";

/** The field's width in px (`w-56`). */
const FIELD_PX = 224;

/** The field's place in the canvas box: at the label, kept inside near the right edge. */
export const labelFieldSpot = (at: { x: number; y: number }, view: OverviewView) => ({
  left: Math.max(0, Math.min(view.x + at.x * view.scale, view.w - FIELD_PX)),
  top: view.y + at.y * view.scale,
});

export function LabelFieldOverlay() {
  const { overviewId } = useOverviewCanvas();
  const field = useLabelField((s) => s.field);
  const view = useOverviewEditor((s) => s.view);
  const gone = useOverviewEditor(
    (s) => field?.itemId != null && !s.items.some((i) => i.id === field.itemId),
  );
  const live = useLive();
  const send = useMapIntent();
  const campaignId = useSync((s) => s.store.you?.campaignId) ?? "";
  const input = useRef<HTMLInputElement>(null);
  const stale = field !== null && (field.overviewId !== overviewId || gone);

  useEffect(() => closeLabelField, []);
  useEffect(() => {
    if (stale) closeLabelField();
  }, [stale]);
  const editing = field?.itemId != null;
  const place = field ? `${field.x},${field.y},${field.itemId}` : null;
  useEffect(() => {
    if (place === null) return;
    const timer = setTimeout(() => {
      input.current?.focus({ preventScroll: true });
      if (editing) input.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [place, editing]);

  if (!field || stale) return null;
  const tooLong = field.text.trim() !== "" && cleanLabelText(field.text) === null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the press and menu from the canvas box; the input is the control
    <div
      data-testid="ovw-label-field"
      data-record-id={field.itemId ?? undefined}
      className="absolute flex w-56 -translate-y-4 flex-col gap-1"
      style={labelFieldSpot(field, view)}
      // The canvas box takes focus on a press, and owns the context menu.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <Input
        ref={input}
        data-testid="ovw-label-input"
        aria-label="Label text"
        aria-invalid={tooLong || undefined}
        className="h-8 bg-background"
        autoComplete="off"
        spellCheck={false}
        readOnly={field.sending}
        value={field.text}
        onChange={(e) => setLabelFieldText(e.target.value)}
        onBlur={() => {
          if (field.itemId && field.text === field.original) closeLabelField();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            closeLabelField();
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submitLabelField(send, {
              live,
              style: lastLabelStyle(campaignId),
              hidden: useAddHidden.getState().on,
            });
          }
        }}
      />
      {tooLong && (
        <p
          data-testid="ovw-label-too-long"
          role="alert"
          className="rounded bg-background px-1 text-xs text-destructive"
        >
          At most {LABEL_TEXT_MAX} characters
        </p>
      )}
      {!live && (
        <p
          data-testid="ovw-label-not-live"
          className="rounded bg-background px-1 text-xs text-muted-foreground"
        >
          Not connected. Your text stays; press Enter once back.
        </p>
      )}
    </div>
  );
}
