// The Label tool and a label's text field (FR-OVW-25, -26; OVW §11): click, type, Enter. A drag pans.
// The field is client state; while not live Enter is off and the text stays until sent or cancelled.
// A send that fails keeps the field and toasts, so a name is never lost. A canvas click while the
// field is open moves it, text and all. DOM-free for `bun test`; the input: `LabelFieldOverlay`.
import {
  type LabelStyle,
  LabelText,
  OVW_INTENTS,
  POSITION_MAX,
} from "@shared/overview-scenes/schemas";
import { create } from "zustand";
import { toastReject } from "../scenes-map/intents";
import { isClick } from "../scenes-map/selection-logic";
import type { OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";
import type { OverviewPointerHandlers } from "./overview-tools";

export interface LabelField {
  overviewId: string;
  /** Edit text: the label it changes; null = a new label. */
  itemId: string | null;
  /** Units. */
  x: number;
  y: number;
  text: string;
  /** What Edit text opened with; Enter on the same text sends nothing. */
  original: string;
  sending: boolean;
}

export const useLabelField = create<{ field: LabelField | null }>(() => ({ field: null }));

export const closeLabelField = (): void => useLabelField.setState({ field: null });

export function setLabelFieldText(text: string): void {
  const { field } = useLabelField.getState();
  if (field && !field.sending) useLabelField.setState({ field: { ...field, text } });
}

/** FR-OVW-26: the text as the server would store it; null if it can't be (blank, too long). */
export function cleanLabelText(text: string): string | null {
  const parsed = LabelText.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** Double-click or the menu's Edit text. */
export function openLabelEdit(item: OverviewItemView): void {
  const text = item.text ?? "";
  useLabelField.setState({
    field: {
      overviewId: item.overviewId,
      itemId: item.id,
      x: item.x,
      y: item.y,
      text,
      original: text,
      sending: false,
    },
  });
}

/** FR-OVW-25's Enter. Holds the field until the ack; the tool stays on for the next label. */
export async function submitLabelField(
  send: ItemSend,
  opts: { live: boolean; style: LabelStyle; hidden: boolean },
): Promise<void> {
  const { field } = useLabelField.getState();
  if (!field || field.sending || !opts.live) return;
  const text = cleanLabelText(field.text);
  if (text === null) return;
  if (field.itemId && text === field.original) {
    closeLabelField();
    return;
  }
  const held = { ...field, sending: true };
  useLabelField.setState({ field: held });
  try {
    const { overviewId, itemId, x, y } = field;
    await (itemId
      ? send(OVW_INTENTS.updateItems, { overviewId, items: [{ itemId, text }] })
      : send(OVW_INTENTS.placeLabel, {
          overviewId,
          x,
          y,
          text,
          style: opts.style,
          ...(opts.hidden ? { hidden: true } : {}),
        }));
    if (useLabelField.getState().field === held) closeLabelField();
  } catch (err) {
    if (useLabelField.getState().field === held) useLabelField.setState({ field });
    toastReject(err);
  }
}

const onWire = (v: number) =>
  Math.round(Math.min(POSITION_MAX, Math.max(-POSITION_MAX, v)) * 100) / 100;

let press: { x: number; y: number } | null = null;

export const labelPointer: OverviewPointerHandlers = {
  down(e) {
    press = e.screen;
  },
  up(e) {
    const from = press;
    press = null;
    if (!from || !e.live || !isClick(e.screen.x - from.x, e.screen.y - from.y)) return;
    const { field } = useLabelField.getState();
    useLabelField.setState({
      field: {
        overviewId: e.overviewId,
        itemId: null,
        x: onWire(e.x),
        y: onWire(e.y),
        text: field && !field.itemId && !field.sending ? field.text : "",
        original: "",
        sending: false,
      },
    });
  },
  /**
   * OVW §11: leaving `live` keeps the field; a tool switch drops it. Esc is the input's own: from
   * anywhere else (the palette, the Game log's dice input) it isn't for the field, and goes on.
   */
  cancel(reason) {
    press = null;
    if (reason === "tool") closeLabelField();
    return false;
  },
};
