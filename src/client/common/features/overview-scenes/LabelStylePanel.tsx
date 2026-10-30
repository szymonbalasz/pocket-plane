// FR-OVW-28's style panel: beside the Label tool it sets the next label's style, for selected labels
// it restyles them. A slider or a colour previews and commits once, on release or on closing the
// picker; a mixed selection shows "Mixed", and a change sends only the changed field to each.
// `LabelTextStyleControls` is the text half, without the dot: a miniature's name takes it too
// (FR-OVW-36). The colour input is the one the map's grid panel uses: the kit's player colour picker
// refuses white and black. Only `LabelStylePreview` carries the DM's colours.
import { LABEL_FONTS, type LabelStyle, type MiniatureStyle } from "@shared/overview-scenes/schemas";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Slider, Switch } from "../../components/ui/menus";
import { Input, Label } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { AddHiddenSwitch } from "./add-hidden";
import {
  fontStack,
  type LabelFontKey,
  labelLayout,
  labelStyleOf,
  type OverviewItemView,
} from "./item-layout";
import { measureText, useLabelFonts } from "./label-fonts";
import {
  type DotStyle,
  type LabelStylePatch,
  lastLabelStyle,
  type Mixed,
  mixedDotStyle,
  mixedTextStyle,
  patchLabelStyle,
  previewStyle,
  rememberLabelStyle,
  restyleItems,
  STYLE_BOUNDS,
  styleNumber,
  type TextStylePatch,
  useLastLabelStyle,
  useStylePreview,
  withStylePreview,
} from "./label-style";
import { dispatchItemSelection } from "./overview-editor";

const FONT_NAMES: Readonly<Record<LabelFontKey, string>> = {
  garamond: "Garamond",
  fell: "IM Fell",
  alegreya: "Alegreya",
};
/** The order the panel offers them: the default first. */
const FONT_ORDER = ["garamond", "fell", "alegreya"] as const satisfies readonly LabelFontKey[];

export const PANEL =
  "flex w-64 flex-col gap-2 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur";
const ROW = "grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2";

interface StyleControlProps<Value, Patch> {
  /** Null fields are mixed. While previewing, the preview's values. */
  value: Value;
  disabled?: boolean;
  /** A local preview, no intent; null drops it. */
  onPreview(patch: Patch | null): void;
  /** One release, one commit. */
  onCommit(patch: Patch): void;
}

function NumberRow({
  id,
  label,
  bounds,
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  id: string;
  label: string;
  bounds: { min: number; max: number };
  value: number | null;
  disabled: boolean | undefined;
  onPreview(v: number | null): void;
  onCommit(v: number): void;
}) {
  const inputId = useId();
  const [typing, setTyping] = useState<string | null>(null);
  const finish = () => {
    if (typing === null) return;
    const v = styleNumber(typing, bounds);
    setTyping(null);
    if (v === null) onPreview(null);
    else onCommit(v);
  };
  return (
    <div className={ROW}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <Slider
        data-testid={`ovw-style-${id}`}
        data-mixed={value === null || undefined}
        aria-label={label}
        min={bounds.min}
        max={bounds.max}
        step={1}
        disabled={disabled}
        value={[value ?? bounds.min]}
        onValueChange={([v]) => v !== undefined && onPreview(v)}
        onValueCommit={([v]) => v !== undefined && onCommit(v)}
      />
      <Input
        id={inputId}
        data-testid={`ovw-style-${id}-input`}
        inputMode="numeric"
        className="h-7 px-1 text-right text-xs tabular-nums"
        placeholder={value === null ? "Mixed" : undefined}
        disabled={disabled}
        value={typing ?? value ?? ""}
        onChange={(e) => {
          setTyping(e.target.value);
          const v = styleNumber(e.target.value, bounds);
          if (v !== null) onPreview(v);
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
          if (e.key === "Escape") {
            setTyping(null);
            onPreview(null);
          }
        }}
      />
    </div>
  );
}

function ColourRow({
  id,
  label,
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  id: string;
  label: string;
  value: string | null;
  disabled: boolean | undefined;
  onPreview(v: string): void;
  onCommit(v: string): void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  // React's onChange is the DOM's `input`, every move. The DOM's `change` fires on closing the picker.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const on = () => commit.current(el.value);
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, []);
  return (
    <div className={ROW}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <input
        ref={input}
        id={inputId}
        data-testid={`ovw-style-${id}`}
        data-mixed={value === null || undefined}
        type="color"
        className="h-7 w-14 cursor-pointer rounded border bg-transparent"
        disabled={disabled}
        value={value ?? "#000000"}
        onChange={(e) => onPreview(e.target.value)}
      />
      {value === null && <span className="text-right text-xs text-muted-foreground">Mixed</span>}
    </div>
  );
}

/** Font, size, colour, stroke colour, stroke width: FR-OVW-27's text fields. */
export function LabelTextStyleControls({
  value,
  disabled,
  onPreview,
  onCommit,
}: StyleControlProps<Mixed<MiniatureStyle>, TextStylePatch>) {
  return (
    <>
      <ToggleGroup
        type="single"
        data-testid="ovw-style-font"
        data-mixed={value.font === null || undefined}
        aria-label="Font"
        className="w-full"
        disabled={disabled}
        value={value.font ?? ""}
        onValueChange={(v) => {
          const font = LABEL_FONTS.find((f) => f === v);
          if (font) onCommit({ font });
        }}
      >
        {FONT_ORDER.map((font) => (
          <ToggleGroupItem
            key={font}
            value={font}
            data-testid={`ovw-style-font-${font}`}
            className="flex-1"
          >
            {FONT_NAMES[font]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <NumberRow
        id="size"
        label="Size"
        bounds={STYLE_BOUNDS.size}
        value={value.size}
        disabled={disabled}
        onPreview={(size) => onPreview(size === null ? null : { size })}
        onCommit={(size) => onCommit({ size })}
      />
      <ColourRow
        id="color"
        label="Colour"
        value={value.color}
        disabled={disabled}
        onPreview={(color) => onPreview({ color })}
        onCommit={(color) => onCommit({ color })}
      />
      <ColourRow
        id="stroke-color"
        label="Stroke"
        value={value.strokeColor}
        disabled={disabled}
        onPreview={(strokeColor) => onPreview({ strokeColor })}
        onCommit={(strokeColor) => onCommit({ strokeColor })}
      />
      <NumberRow
        id="stroke-width"
        label="Stroke width"
        bounds={STYLE_BOUNDS.strokeWidth}
        value={value.strokeWidth}
        disabled={disabled}
        onPreview={(strokeWidth) => onPreview(strokeWidth === null ? null : { strokeWidth })}
        onCommit={(strokeWidth) => onCommit({ strokeWidth })}
      />
    </>
  );
}

/** Dot on / off, size, colour, stroke colour, stroke width. Mixed or on shows the dot's rows. */
function LabelDotStyleControls({
  value,
  disabled,
  onPreview,
  onCommit,
}: StyleControlProps<Mixed<DotStyle>, Partial<DotStyle>>) {
  const switchId = useId();
  return (
    <>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          data-testid="ovw-style-dot"
          data-mixed={value.on === null || undefined}
          disabled={disabled}
          checked={value.on === true}
          onCheckedChange={(on) => onCommit({ on })}
        />
        <Label htmlFor={switchId} className="text-xs">
          Dot{value.on === null ? " (mixed)" : ""}
        </Label>
      </div>
      {value.on !== false && (
        <>
          <NumberRow
            id="dot-size"
            label="Dot size"
            bounds={STYLE_BOUNDS.dotSize}
            value={value.size}
            disabled={disabled}
            onPreview={(size) => onPreview(size === null ? null : { size })}
            onCommit={(size) => onCommit({ size })}
          />
          <ColourRow
            id="dot-color"
            label="Dot colour"
            value={value.color}
            disabled={disabled}
            onPreview={(color) => onPreview({ color })}
            onCommit={(color) => onCommit({ color })}
          />
          <ColourRow
            id="dot-stroke-color"
            label="Dot stroke"
            value={value.strokeColor}
            disabled={disabled}
            onPreview={(strokeColor) => onPreview({ strokeColor })}
            onCommit={(strokeColor) => onCommit({ strokeColor })}
          />
          <NumberRow
            id="dot-stroke-width"
            label="Dot stroke width"
            bounds={STYLE_BOUNDS.strokeWidth}
            value={value.strokeWidth}
            disabled={disabled}
            onPreview={(strokeWidth) => onPreview(strokeWidth === null ? null : { strokeWidth })}
            onCommit={(strokeWidth) => onCommit({ strokeWidth })}
          />
        </>
      )}
    </>
  );
}

function LabelStyleControls({
  styles,
  disabled,
  onPreview,
  onCommit,
}: Omit<StyleControlProps<never, LabelStylePatch>, "value"> & {
  styles: readonly LabelStyle[];
}) {
  return (
    <>
      <LabelTextStyleControls
        value={mixedTextStyle(styles)}
        disabled={disabled}
        onPreview={onPreview}
        onCommit={onCommit}
      />
      <LabelDotStyleControls
        value={mixedDotStyle(styles)}
        disabled={disabled}
        onPreview={(dot) => onPreview(dot && { dot })}
        onCommit={(dot) => onCommit({ dot })}
      />
    </>
  );
}

const SAMPLE = "Thundertree";

/** The next label, drawn with FR-OVW-29's layout; re-measures once its font has loaded (-30). */
export function LabelStylePreview({ style }: { style: LabelStyle }) {
  const fontRev = useLabelFonts(useMemo(() => [style.font], [style.font]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontRev`: the same text measures anew once its font has loaded.
  const layout = useMemo(() => labelLayout(style, measureText(SAMPLE, style)), [style, fontRev]);
  const { box } = layout;
  return (
    <svg
      data-testid="ovw-style-preview"
      data-font={style.font}
      data-font-rev={fontRev}
      role="img"
      aria-label={`Preview: ${SAMPLE}`}
      className="h-10 w-full rounded bg-muted"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {layout.dotR !== null && (
        <circle
          r={layout.dotR}
          fill={style.dot.color}
          stroke={style.dot.strokeColor}
          strokeWidth={style.dot.strokeWidth}
        />
      )}
      <text
        x={layout.textX}
        dominantBaseline="central"
        fontFamily={fontStack(style.font)}
        fontSize={style.size}
        fill={style.color}
        stroke={style.strokeColor}
        strokeWidth={style.strokeWidth}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {SAMPLE}
      </text>
    </svg>
  );
}

const useCampaignId = () => useSync((s) => s.store.you?.campaignId) ?? "";

/** Beside the Label tool: no settings to open, it just sets what the next label takes. */
export function LabelToolPanel() {
  const campaignId = useCampaignId();
  const live = useLive();
  const stored = useLastLabelStyle((s) => s.byCampaign[campaignId]);
  const [patch, setPatch] = useState<LabelStylePatch | null>(null);
  const last = stored ?? lastLabelStyle(campaignId);
  const style = patch ? patchLabelStyle(last, patch) : last;
  // This panel styles the next label, so nothing selected may look as if it were being restyled.
  useEffect(() => dispatchItemSelection({ type: "clear" }), []);
  return (
    <div data-testid="ovw-label-panel" className={PANEL}>
      <LabelStylePreview style={style} />
      <LabelStyleControls
        styles={[style]}
        disabled={!live}
        onPreview={setPatch}
        onCommit={(p) => {
          // FR-OVW-47: a picker still open or a drag still held when the connection went.
          if (live) rememberLabelStyle(campaignId, p);
          setPatch(null);
        }}
      />
      <AddHiddenSwitch disabled={!live} />
    </div>
  );
}

/** For selected labels, one or many (FR-OVW-28): the canvas is the preview. */
export function SelectedLabelsPanel({ items }: { items: readonly OverviewItemView[] }) {
  const campaignId = useCampaignId();
  const live = useLive();
  const send = useMapIntent();
  const preview = useStylePreview((s) => s.preview);
  const ids = items.map((i) => i.id);
  const styles = items.map((i) => labelStyleOf(withStylePreview(i, preview)));
  useEffect(() => () => previewStyle([], null), []);
  return (
    <div data-testid="ovw-style-panel" data-count={items.length} className={PANEL}>
      <LabelStyleControls
        styles={styles}
        disabled={!live}
        onPreview={(p) => previewStyle(ids, p)}
        onCommit={(p) => {
          rememberLabelStyle(campaignId, p);
          restyleItems(send, items, p).catch(toastReject);
        }}
      />
    </div>
  );
}
