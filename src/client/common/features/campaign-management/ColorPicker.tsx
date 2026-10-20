// FR-CAMP-35 colour picker (CAMP §7; supersedes the sprint-5 8-swatch Popover): palette row,
// saturation × brightness square for the current hue (pointer capture, 2-D keyboard, shaded where
// the rules fail), hue slider, hex field, preview, reason line, others' colours, Apply. Edits are
// a local draft; Apply sends `camp.setColor` (FR-CAMP-33). Every marker target is clamped by the
// exact rules (`clamp`); the mask only draws. Used by the Preferences "Your colour" section and
// the DM's Players panel Popover. Nothing is optimistic: a reject toasts and the draft resets.
import {
  type ColorHolder,
  colorClash,
  colorLabel,
  colorName,
  normalizeColor,
  type PaletteKey,
  PLAYER_COLOR_KEYS,
  PLAYER_COLORS,
} from "@shared/campaign-management/colors";
import type {
  CampaignRecord,
  PlayerRecord,
  SetColorInput,
} from "@shared/campaign-management/schemas";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Slider } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { toastReject } from "../scenes-map/intents";
import {
  BAD_HEX_MESSAGE,
  type Clamped,
  clamp,
  type Hsv,
  hexToHsv,
  MASK_CELLS,
  maskPath,
  NO_COLOUR_MESSAGE,
  type PickerReason,
  type PickerRules,
  parseHexInput,
  pickerRules,
  type Sv,
} from "./color-picker";
import { colorHex } from "./colors";

export const SET_COLOR_INTENT = "camp.setColor";

/** Whose colour a picker sets: a player's id, or `null` = the DM colour (FR-CAMP-25). */
export type ColorTarget = string | null;

export interface ColorHolders {
  players: readonly Pick<PlayerRecord, "id" | "name" | "color">[];
  dmColor: string | undefined;
}

/** Everyone's colour but the target's: the DM first, then players (FR-CAMP-32's "others"). */
export function othersOf({ players, dmColor }: ColorHolders, target: ColorTarget): ColorHolder[] {
  return [
    ...(target !== null && dmColor ? [{ by: "dm", name: "DM", color: dmColor }] : []),
    ...players
      .filter((p) => p.id !== target)
      .map((p) => ({ by: p.id, name: p.name, color: p.color })),
  ];
}

/** The target's stored colour (lowercase hex), or null when unreadable. */
export function ownColor({ players, dmColor }: ColorHolders, target: ColorTarget): string | null {
  return normalizeColor(target === null ? dmColor : players.find((p) => p.id === target)?.color);
}

export interface PaletteSwatch {
  key: PaletteKey;
  hex: string;
  /** "Rose" (aria-label, `data-name`). */
  name: string;
  /** FR-CAMP-32 clash for this person (player id | `dm`), or null. */
  blockedBy: string | null;
  reason: PickerReason | null;
  message: string | null;
  /** The draft's colour. */
  checked: boolean;
}

/**
 * The palette row: a palette colour that breaks FR-CAMP-32 for this person is blocked with its
 * reason; the target's own stored colour never is (a repeated default may share it).
 */
export function paletteSwatches(
  others: readonly ColorHolder[],
  own: string | null,
  draft: string,
): PaletteSwatch[] {
  return PLAYER_COLOR_KEYS.map((key) => {
    const hex = PLAYER_COLORS[key];
    const clash = own === hex ? null : colorClash(hex, others);
    return {
      key,
      hex,
      name: colorLabel(key),
      blockedBy: clash?.by ?? null,
      reason: clash?.reason ?? null,
      message: clash?.message ?? null,
      checked: draft === hex,
    };
  });
}

/** Sends FR-CAMP-33; a reject goes to `onReject` (Toast), a disconnect to the banner. */
export function pickColor(
  send: (name: string, payload: unknown) => Promise<unknown>,
  target: ColorTarget,
  color: string,
  onReject: (err: unknown) => void = toastReject,
): Promise<boolean> {
  const input: SetColorInput = { playerId: target, color };
  return send(SET_COLOR_INTENT, input).then(
    () => true,
    (err) => {
      onReject(err);
      return false;
    },
  );
}

/** The campaign's players and DM colour from the live store. */
export function useHolders(): ColorHolders {
  const player = useSync((s) => s.store.records.player) as Record<string, PlayerRecord> | undefined;
  const campaign = useSync((s) => s.store.records.campaign) as
    | Record<string, CampaignRecord>
    | undefined;
  const you = useSync((s) => s.store.you);
  return useMemo(() => {
    const own = (you?.campaignId && campaign?.[you.campaignId]) || Object.values(campaign ?? {})[0];
    return { players: Object.values(player ?? {}), dmColor: own?.dmColor };
  }, [player, campaign, you]);
}

/** The square's 2-D keyboard (CAMP §7): arrows 1 % (Shift 10 %), Home / End, PageUp / PageDown. */
export function keyTarget(key: string, shift: boolean, { s, v }: Sv): Sv | null {
  const step = shift ? 10 : 1;
  const c = (x: number) => Math.min(100, Math.max(0, x));
  switch (key) {
    case "ArrowLeft":
      return { s: c(s - step), v };
    case "ArrowRight":
      return { s: c(s + step), v };
    case "ArrowUp":
      return { s, v: c(v + step) };
    case "ArrowDown":
      return { s, v: c(v - step) };
    case "Home":
      return { s: 0, v };
    case "End":
      return { s: 100, v };
    case "PageUp":
      return { s, v: 100 };
    case "PageDown":
      return { s, v: 0 };
    default:
      return null;
  }
}

const HUE_GRADIENT =
  "linear-gradient(to right,#f00,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00)";

/** The draft as the picker holds it: an exact hex (typed or a swatch) plus the marker. */
export type Draft = Clamped;

export const draftOf = (hex: string, h?: number): Draft => {
  const p = hexToHsv(hex);
  // A grey has no hue of its own: keep the slider where it was.
  return { ...p, h: p.s === 0 && h !== undefined ? h : p.h, hex, none: false };
};

export interface PickerStatus {
  reason: PickerReason | null;
  message: string;
  /** A block (`accent.danger`); else a name hint (`text.muted`). */
  block: boolean;
}

/**
 * The reason line and Apply (FR-CAMP-35): a hovered / focused swatch names its block (or its
 * name); else the draft's problem: a hex field that doesn't parse, no allowed colour at this hue,
 * FR-CAMP-31 / -32. Apply needs live, nothing in flight, no problem and a changed draft.
 */
export function pickerView(p: {
  draft: Draft;
  hexText: string | null;
  hint: PaletteSwatch | null;
  stored: string | null;
  rules: PickerRules;
  live: boolean;
  inFlight: boolean;
}): { badHex: boolean; status: PickerStatus | null; canApply: boolean } {
  const badHex = p.hexText !== null && parseHexInput(p.hexText, false) === null;
  const verdict = badHex
    ? { reason: "bad-hex" as const, message: BAD_HEX_MESSAGE }
    : p.draft.none
      ? { reason: "no-colour" as const, message: NO_COLOUR_MESSAGE }
      : p.rules.verdict(p.draft.hex);
  const { hint } = p;
  const status = hint
    ? { reason: hint.reason, message: hint.message ?? hint.name, block: hint.reason !== null }
    : verdict
      ? { reason: verdict.reason, message: verdict.message, block: true }
      : null;
  const canApply = p.live && !p.inFlight && verdict === null && p.draft.hex !== p.stored;
  return { badHex, status, canApply };
}

export function ColorPicker({ target }: { target: ColorTarget }) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const holders = useHolders();
  const stored = ownColor(holders, target);
  const others = useMemo(() => othersOf(holders, target), [holders, target]);
  const rules = useMemo(() => pickerRules(others), [others]);
  const cache = useRef(new Set<string>()).current;
  const [pick, setPick] = useState<Draft | null>(null);
  const [hexText, setHexText] = useState<string | null>(null);
  const [hint, setHint] = useState<PaletteSwatch | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const draft = pick ?? draftOf(stored ?? PLAYER_COLORS.amber);
  // The draft follows the store once it equals it (an Apply landed, or someone set the same).
  useEffect(() => {
    if (pick && pick.hex === stored) setPick(null);
  }, [pick, stored]);

  const mask = useMemo(() => maskPath(draft.h, rules), [draft.h, rules]);
  const swatches = paletteSwatches(others, stored, draft.hex);
  const { badHex, status, canApply } = pickerView({
    draft,
    hexText,
    hint,
    stored,
    rules,
    live,
    inFlight,
  });

  const move = (t: Hsv) => {
    setHexText(null);
    setPick(clamp(t, rules, cache));
  };
  const take = (hex: string) => {
    setHexText(null);
    setPick(draftOf(hex, draft.h));
  };
  const apply = () => {
    if (!canApply) return;
    setInFlight(true);
    void pickColor(
      (n, p) => connection.sendIntent(n, p),
      target,
      draft.hex,
      (err) => {
        toastReject(err);
        setPick(null);
        setHexText(null);
      },
    ).finally(() => setInFlight(false));
  };

  const square = useRef<HTMLDivElement>(null);
  const pointerTo = (e: React.PointerEvent) => {
    const r = square.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    const c = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100);
    move({
      h: draft.h,
      s: c((e.clientX - r.left) / r.width),
      v: c(1 - (e.clientY - r.top) / r.height),
    });
  };

  return (
    <div
      data-testid="camp-color-picker"
      data-target={target ?? "dm"}
      className="flex w-[18rem] max-w-full flex-col gap-2"
    >
      <div className="flex justify-between">
        {swatches.map((s) => (
          <button
            key={s.key}
            type="button"
            data-testid="camp-color-swatch"
            data-value={s.hex}
            data-name={s.name}
            data-blocked-by={s.blockedBy ?? undefined}
            data-state={s.checked ? "checked" : "unchecked"}
            aria-label={s.name}
            aria-pressed={s.checked}
            // Blocked swatches stay hoverable and focusable so the reason line can name the
            // reason (no Tooltip over the row above, BL-36).
            aria-disabled={s.blockedBy !== null || undefined}
            onClick={() => s.blockedBy === null && take(s.hex)}
            onPointerEnter={() => setHint(s)}
            onPointerLeave={() => setHint(null)}
            onFocus={() => setHint(s)}
            onBlur={() => setHint(null)}
            style={{ backgroundColor: s.hex }}
            className="inline-flex size-6 items-center justify-center rounded-full text-black ring-offset-2 ring-offset-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          >
            {s.checked && <CheckIcon className="size-4" strokeWidth={3} />}
          </button>
        ))}
      </div>
      <div
        ref={square}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={draft.s}
        aria-valuetext={`Saturation ${draft.s} %, brightness ${draft.v} %`}
        data-testid="camp-color-sv"
        data-hue={draft.h}
        className="relative h-32 w-full cursor-crosshair touch-none select-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${draft.h} 100% 50%))`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerTo(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pointerTo(e);
        }}
        onKeyDown={(e) => {
          const t = keyTarget(e.key, e.shiftKey, draft);
          if (!t) return;
          e.preventDefault();
          move({ h: draft.h, ...t });
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full rounded-sm"
          viewBox={`0 0 ${MASK_CELLS} ${MASK_CELLS}`}
          preserveAspectRatio="none"
        >
          <path
            d={mask}
            className="fill-background"
            fillOpacity={0.7}
            shapeRendering="crispEdges"
          />
        </svg>
        <span
          data-testid="camp-color-sv-marker"
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-primary shadow"
          style={{ left: `${draft.s}%`, bottom: `${draft.v}%`, backgroundColor: draft.hex }}
        />
      </div>
      <Slider
        data-testid="camp-color-hue"
        aria-label="Hue"
        min={0}
        max={359}
        step={1}
        value={[draft.h]}
        onValueChange={([h]) => h !== undefined && move({ h, s: draft.s, v: draft.v })}
        // The Slider's track shows the hue gradient; its filled range is hidden.
        className="[&>span:first-child>span]:bg-transparent [&>span:first-child]:h-3 [&>span:first-child]:bg-(image:--hue)"
        style={{ ["--hue" as string]: HUE_GRADIENT }}
      />
      <div className="flex items-center gap-2">
        <Input
          data-testid="camp-color-hex"
          aria-label="Hex colour"
          aria-invalid={badHex || undefined}
          spellCheck={false}
          className="h-8 w-24 font-mono text-xs"
          value={hexText ?? draft.hex}
          onChange={(e) => {
            const text = e.target.value;
            const hex = parseHexInput(text, false);
            setHexText(text);
            if (hex) setPick(draftOf(hex, draft.h));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commitHex();
          }}
          onBlur={commitHex}
        />
        <Preview color={draft.hex} name={target === null ? "DM" : nameOf(holders, target)} />
      </div>
      <p
        data-testid="camp-color-status"
        data-reason={status?.reason ?? undefined}
        aria-live="polite"
        className={cn(
          "min-h-4 truncate text-xs leading-4",
          status?.block ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status?.message ?? ""}
      </p>
      <div className="flex items-end justify-between gap-2">
        <p data-testid="camp-color-others" className="min-w-0 text-xs text-muted-foreground">
          {others.map((o, i) => (
            <span key={o.by} className="whitespace-nowrap">
              {i > 0 && " · "}
              <span style={{ color: colorHex(normalizeColor(o.color) ?? o.color) }}>●</span>{" "}
              {o.name}
            </span>
          ))}
        </p>
        <Button
          size="sm"
          data-testid="camp-color-apply"
          disabled={!canApply}
          onClick={apply}
          className="shrink-0"
        >
          Apply
        </Button>
      </div>
    </div>
  );

  function commitHex() {
    if (hexText === null) return;
    const hex = parseHexInput(hexText);
    if (!hex) return;
    setHexText(null);
    setPick(draftOf(hex, draft.h));
  }
}

const nameOf = ({ players }: ColorHolders, id: string) =>
  players.find((p) => p.id === id)?.name ?? "Player";

/**
 * The person's name chip in the draft colour over the dark casing (as the map's laser chip draws
 * it: `#000` at 85 %, 11 px), on a light and a dark map tile.
 */
function Preview({ color, name }: { color: string; name: string }) {
  return (
    <div data-testid="camp-color-preview" data-color={color} className="flex min-w-0 flex-1 gap-1">
      {["#d6d3d1", "#292524"].map((tile) => (
        <div
          key={tile}
          className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-sm"
          style={{ backgroundColor: tile }}
        >
          <span
            className="truncate rounded-full px-1.5 text-[11px] leading-4"
            style={{ color, backgroundColor: "rgb(0 0 0 / 0.85)" }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The DM's Players panel swatch (CAMP §7): a 16 px round Button in the person's colour
 * (`data-value` = hex) opening a Popover "Colour for ‹name›" with the picker.
 */
export function ColorPickerPopover({
  target,
  testId,
  recordId,
  tip,
}: {
  target: ColorTarget;
  testId: string;
  recordId?: string;
  tip: string;
}) {
  const holders = useHolders();
  const stored = ownColor(holders, target);
  const name = target === null ? "DM" : nameOf(holders, target);
  return (
    <Popover>
      <Tooltip content={tip}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="size-4 shrink-0 rounded-full p-0 align-middle"
            style={{ backgroundColor: stored ?? undefined }}
            data-testid={testId}
            data-record-id={recordId}
            data-value={stored ?? undefined}
            aria-label={`${tip}: ${stored ? colorName(stored) : "Unknown"}`}
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent data-testid="camp-color-popover" className="flex w-auto flex-col gap-2 p-3">
        <p className="text-sm font-medium">Colour for {name}</p>
        <ColorPicker target={target} />
      </PopoverContent>
    </Popover>
  );
}
