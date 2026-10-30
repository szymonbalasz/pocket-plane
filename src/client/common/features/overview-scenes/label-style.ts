// Editing an item's text style (FR-OVW-27, -28, -36): a change is a patch of the fields it touches,
// so a mixed selection keeps what it doesn't change. A patch previews locally (`useStylePreview`, no
// intent) and commits once with `restyleItems`; the preview stays until the ack, as a gesture's does.
// The last style per browser per campaign is what a new label takes. DOM-free for `bun test`.
import {
  DOT_SIZE,
  FONT_SIZE,
  LABEL_STYLE_DEFAULT,
  LabelStyle,
  type MiniatureStyle,
  OVW_INTENTS,
  STROKE_WIDTH_MAX,
} from "@shared/overview-scenes/schemas";
import { create } from "zustand";
import { withinGroupCap } from "./item-actions";
import { labelStyleOf, nameStyleOf, type OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";

export type DotStyle = LabelStyle["dot"];
export type TextStylePatch = Partial<MiniatureStyle>;
export type LabelStylePatch = TextStylePatch & { dot?: Partial<DotStyle> };

/** FR-OVW-27 as the controls' bounds. */
export const STYLE_BOUNDS = {
  size: FONT_SIZE,
  strokeWidth: { min: 0, max: STROKE_WIDTH_MAX },
  dotSize: DOT_SIZE,
} as const;

/** A typed number inside its bounds, whole; null if it isn't a number. */
export function styleNumber(text: string, bounds: { min: number; max: number }): number | null {
  const v = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(v)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(v)));
}

export const patchLabelStyle = (
  style: LabelStyle,
  { dot, ...text }: LabelStylePatch,
): LabelStyle => ({ ...style, ...text, dot: { ...style.dot, ...dot } });

/** The whole style `ovw.updateItems` takes: this item's, with only the patch's fields changed. */
export function patchedStyleOf(
  item: Pick<OverviewItemView, "kind" | "style">,
  patch: LabelStylePatch,
): LabelStyle | MiniatureStyle {
  if (item.kind === "label") return patchLabelStyle(labelStyleOf(item), patch);
  const { dot: _noDot, ...text } = patch;
  return { ...nameStyleOf(item), ...text };
}

const styleOfItem = (item: Pick<OverviewItemView, "kind" | "style">) =>
  item.kind === "label" ? labelStyleOf(item) : nameStyleOf(item);

// ---------- mixed selections (FR-OVW-28) ----------

/** One value per field; null = the selection differs on it. */
export type Mixed<T> = { [K in keyof T]: T[K] | null };

function mixedFields<T, K extends keyof T>(
  list: readonly T[],
  keys: readonly K[],
): { [F in K]: T[F] | null } {
  const out = {} as { [F in K]: T[F] | null };
  for (const key of keys) {
    const first = list[0]?.[key];
    out[key] = first !== undefined && list.every((s) => s[key] === first) ? first : null;
  }
  return out;
}

const TEXT_FIELDS = ["font", "size", "color", "strokeColor", "strokeWidth"] as const;
const DOT_FIELDS = ["on", "size", "color", "strokeColor", "strokeWidth"] as const;

export const mixedTextStyle = (styles: readonly MiniatureStyle[]): Mixed<MiniatureStyle> =>
  mixedFields(styles, TEXT_FIELDS);

export const mixedDotStyle = (styles: readonly LabelStyle[]): Mixed<DotStyle> =>
  mixedFields(
    styles.map((s) => s.dot),
    DOT_FIELDS,
  );

// ---------- the preview ----------

export interface StylePreview {
  ids: readonly string[];
  patch: LabelStylePatch;
}

/** Client only, apart from the gestures so a slider's frames re-render only the items it touches. */
export const useStylePreview = create<{ preview: StylePreview | null }>(() => ({ preview: null }));

export const previewStyle = (ids: readonly string[], patch: LabelStylePatch | null): void =>
  useStylePreview.setState({ preview: patch ? { ids, patch } : null });

/** The item as a preview draws it. */
export function withStylePreview<T extends OverviewItemView>(
  item: T,
  preview: StylePreview | null,
): T {
  return preview?.ids.includes(item.id)
    ? { ...item, style: patchedStyleOf(item, preview.patch) }
    : item;
}

/** Commits not yet acked: the intent takes a whole style, so a quick next change must carry them. */
let unsettled: readonly StylePreview[] = [];

/**
 * FR-OVW-28's commit: one intent, each item with only the patch's fields changed. Items it doesn't
 * change aren't sent; nothing changes → nothing sent. A reject drops the preview and rethrows.
 */
export async function restyleItems(
  send: ItemSend,
  items: readonly OverviewItemView[],
  patch: LabelStylePatch,
): Promise<void> {
  const held: StylePreview = { ids: items.map((i) => i.id), patch };
  useStylePreview.setState({ preview: held });
  const drop = () => {
    unsettled = unsettled.filter((u) => u !== held);
    if (useStylePreview.getState().preview === held) useStylePreview.setState({ preview: null });
  };
  const change = items.flatMap((item) => {
    const ahead = unsettled.reduce(withStylePreview, item);
    const style = patchedStyleOf(ahead, patch);
    return JSON.stringify(style) === JSON.stringify(styleOfItem(ahead))
      ? []
      : [{ itemId: item.id, style }];
  });
  const first = items[0];
  if (!first || change.length === 0 || !withinGroupCap(change.length)) {
    drop();
    return;
  }
  unsettled = [...unsettled, held];
  try {
    await send(OVW_INTENTS.updateItems, { overviewId: first.overviewId, items: change });
  } finally {
    drop();
  }
}

// ---------- the last style (FR-OVW-28) ----------

type StyleStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): StyleStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const styleKey = (campaignId: string) => `pp.overview.v1.label-style.${campaignId}`;

/** Stored JSON → a style; anything invalid → FR-OVW-27's default. */
export function loadLabelStyle(
  campaignId: string,
  storage: StyleStorage | null = browserStorage(),
): LabelStyle {
  try {
    const parsed = LabelStyle.safeParse(JSON.parse(storage?.getItem(styleKey(campaignId)) ?? ""));
    return parsed.success ? parsed.data : LABEL_STYLE_DEFAULT;
  } catch {
    return LABEL_STYLE_DEFAULT;
  }
}

/** Blocked storage: it still holds for this page. */
export function saveLabelStyle(
  campaignId: string,
  style: LabelStyle,
  storage: StyleStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(styleKey(campaignId), JSON.stringify(style));
  } catch {}
}

export const useLastLabelStyle = create<{ byCampaign: Readonly<Record<string, LabelStyle>> }>(
  () => ({ byCampaign: {} }),
);

/** What the next label takes. */
export const lastLabelStyle = (campaignId: string): LabelStyle =>
  useLastLabelStyle.getState().byCampaign[campaignId] ?? loadLabelStyle(campaignId);

/** A committed change, in the tool's panel or on selected labels: only its fields carry over. */
export function rememberLabelStyle(campaignId: string, patch: LabelStylePatch): void {
  const style = patchLabelStyle(lastLabelStyle(campaignId), patch);
  saveLabelStyle(campaignId, style);
  useLastLabelStyle.setState((s) => ({ byCampaign: { ...s.byCampaign, [campaignId]: style } }));
}
