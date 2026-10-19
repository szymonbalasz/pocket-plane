// The tray's dice area in `compose`, `adjust` and `rolling` (FR-DICEX-48, §6.1 table C; amends
// FR-DICEX-04, -05, -08 b, e): the dice that will be rolled, highest face up, in the viewer's
// look. 3D: static stills drawn through a temporary arena of the page's one WebGL canvas into
// this area's own 2D canvas (`dicex-tray-preview`), so they keep the window's z-order; no loop.
// Else `DieShape` chips. Each die has a DOM mirror (`dicex-tray-die`): a button in `compose`
// (click removes one), a span otherwise. More than 12 dice → one die per term "×N".
import type { DiceLook } from "@shared/dice-extras/looks";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { DieShape } from "./DieShape";
import type { TrayStill } from "./dice3d/index";
import { diceLayerHost } from "./layer-host";
import { dice3d, useChunk3d } from "./lazy3d";
import { useOwnLook } from "./own-look";
import { useDiceSettings } from "./settings";
import type { TrayRequest } from "./store";
import { type TrayExtraDice, trayExtras } from "./tray-extras";
import {
  extraChips,
  GROUP_OVER,
  type PreviewDie,
  parseStill,
  previewDice,
  stillParts,
  type TrayChip,
  trayPreviewMode,
  trayWantsChunk,
} from "./tray-logic";

/** One expression's dice and constant ("+5" after the dice). */
export interface TrayGroup {
  chips: TrayChip[];
  constant: number;
}

const signed = (n: number) => (n === 0 ? "" : n > 0 ? `+${n}` : `−${-n}`);

/**
 * FR-DICEX-08 b: every registry entry's dice for this request, in `order` (each `useDice` hook
 * runs every render; the registry is fixed at module load, so the order never changes).
 */
function useExtraDice(request: TrayRequest, mode: RollMode) {
  const sorted = [...trayExtras].sort((a, b) => a.order - b.order);
  return sorted.map((x) => ({
    key: x.key,
    // biome-ignore lint/correctness/useHookAtTopLevel: a fixed list, so the same hooks in the same order every render
    dice: x.useDice(request, mode),
  }));
}

/** Still cells under `root`, in CSS px from `canvas`'s top-left. */
function cellsOf(root: HTMLElement, canvas: HTMLCanvasElement): TrayStill[] {
  const o = canvas.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>("[data-still]")].flatMap((el) => {
    const s = parseStill(el.dataset.still);
    if (!s) return [];
    const r = el.getBoundingClientRect();
    return [{ ...s, x: r.left - o.left, y: r.top - o.top, size: r.width }];
  });
}

/** One die's DOM mirror: still cells (3D) or a `DieShape` chip, its tag and "×N". */
export function TrayDie({
  die,
  render,
  look,
  onRemove,
}: {
  die: PreviewDie;
  render: "3d" | "chips";
  look: DiceLook;
  onRemove?: () => void;
}) {
  const text = `${die.sign === -1 ? "−" : ""}d${die.faces}`;
  const parts = render === "3d" ? stillParts(die.faces) : null;
  const body = (
    <>
      {parts ? (
        <>
          {die.sign === -1 && <span className="font-mono text-sm">−</span>}
          {parts.map((p) => (
            <span key={p} data-still={p} aria-hidden className="block size-10 shrink-0" />
          ))}
        </>
      ) : (
        <DieShape
          faces={die.faces}
          value={die.faces}
          look={look}
          negative={die.sign === -1}
          label={text}
        />
      )}
      {die.tag && (
        <span className="absolute -top-1.5 -right-1.5 rounded bg-primary px-1 text-[9px] leading-tight text-primary-foreground">
          {die.tag}
        </span>
      )}
      {die.group && (
        <span className="absolute -right-1.5 -bottom-1.5 rounded bg-secondary px-1 font-mono text-[10px] leading-tight">
          ×{die.group}
        </span>
      )}
    </>
  );
  const attrs = {
    "data-testid": "dicex-tray-die",
    "data-faces": die.faces,
    "data-term": die.term,
    ...(die.tag && { "data-tag": die.tag }),
    ...(die.group && { "data-group": die.group }),
    "data-value": die.faces,
  };
  const cls = "relative flex h-10 min-w-10 items-center justify-center rounded-md";
  return onRemove ? (
    <button
      type="button"
      {...attrs}
      aria-label={`Remove one ${text}`}
      className={cn(
        cls,
        "outline-none hover:ring-2 hover:ring-destructive focus-visible:ring-2 focus-visible:ring-destructive",
      )}
      onClick={onRemove}
    >
      {body}
    </button>
  ) : (
    <span {...attrs} className={cls}>
      {body}
    </span>
  );
}

function ExtraDice({
  extraKey,
  dice,
  grouped,
  render,
  look,
}: {
  extraKey: string;
  dice: TrayExtraDice[];
  grouped: boolean;
  render: "3d" | "chips";
  look: DiceLook;
}) {
  if (dice.length === 0) return null;
  return (
    <span
      data-testid="dicex-tray-extra"
      data-value={extraKey}
      className="flex flex-wrap items-center gap-1"
    >
      {dice.map((d, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: positional per render
          key={i}
          data-testid="dicex-tray-extra-die"
          data-faces={d.faces}
          {...(d.key ? { "data-key": d.key } : {})}
          className="flex items-center gap-1 rounded-md border border-dashed pl-1.5 text-muted-foreground"
        >
          <span className="font-mono text-xs">
            {d.label} {d.sign === -1 ? "−" : "+"}
            {d.count}d{d.faces}
          </span>
          {previewDice(extraChips([d]), grouped).map((c, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one die per position
            <TrayDie key={j} die={{ ...c, term: i }} render={render} look={look} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function TrayPreview({
  request,
  groups,
  mode,
  onRemove,
  dimmed = false,
}: {
  request: TrayRequest;
  groups: TrayGroup[];
  /** The previewed mode (FR-DICEX-08 e), for the extras' hooks. */
  mode: RollMode;
  /** `compose`: a click on an untagged die removes one of its term. */
  onRemove?: (term: number) => void;
  /** `rolling`: the preview stays, dimmed. */
  dimmed?: boolean;
}) {
  const extras = useExtraDice(request, mode);
  const look = useOwnLook();
  const { display } = useDiceSettings();
  const chunk = useChunk3d();
  const [failed, setFailed] = useState(false);
  const render = trayPreviewMode(display, chunk, failed);
  useEffect(() => trayWantsChunk(display, dice3d), [display]);

  const count =
    groups.reduce((n, g) => n + g.chips.length, 0) +
    extras.reduce((n, x) => n + extraChips(x.dice).length, 0);
  const grouped = count > GROUP_OVER;
  const dice = useMemo(() => groups.map((g) => previewDice(g.chips, grouped)), [groups, grouped]);

  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Redraw when the dice, tags, look or the area's size change; one draw each, no loop.
  const drawKey = JSON.stringify([dice, extras, grouped, look]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraws on `drawKey`
  useLayoutEffect(() => {
    const mod = dice3d.module();
    const el = root.current;
    const c = canvas.current;
    if (render !== "3d" || !mod || !el || !c) return;
    const layer = diceLayerHost.current;
    if (!layer) return setFailed(true);
    const paint = () => {
      try {
        mod.drawTrayStills(layer, c, cellsOf(el, c), look);
      } catch (err) {
        console.warn("Dice: the tray's 3D dice failed; showing flat dice.", err);
        setFailed(true);
      }
    };
    paint();
    let size = `${el.clientWidth}x${el.clientHeight}`;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            const now = `${el.clientWidth}x${el.clientHeight}`;
            if (now === size) return;
            size = now;
            paint();
          })
        : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      mod.cancelTrayStills(c);
    };
  }, [render, drawKey]);

  return (
    <div
      ref={root}
      className={cn(
        "relative flex min-h-10 w-full flex-wrap items-center gap-1",
        dimmed && "opacity-50",
      )}
    >
      <canvas
        // A fresh canvas per mode: chips never sit over an old still.
        key={render}
        ref={canvas}
        data-testid="dicex-tray-preview"
        data-mode={render}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      {groups.map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one group per expression position
        <span key={i} className="flex flex-wrap items-center gap-1">
          {i > 0 && <span className="px-1 text-muted-foreground">·</span>}
          {(dice[i] ?? []).map((d, j) => (
            <TrayDie
              // biome-ignore lint/suspicious/noArrayIndexKey: one die per position
              key={j}
              die={d}
              render={render}
              look={look}
              onRemove={onRemove && !d.tag ? () => onRemove(d.term) : undefined}
            />
          ))}
          {g.constant !== 0 && (
            <span className="relative font-mono text-sm text-muted-foreground">
              {signed(g.constant)}
            </span>
          )}
        </span>
      ))}
      {extras.map((x) => (
        <ExtraDice
          key={x.key}
          extraKey={x.key}
          dice={x.dice}
          grouped={grouped}
          render={render}
          look={look}
        />
      ))}
    </div>
  );
}
