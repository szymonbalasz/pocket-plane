// The tray's dice area in `compose`, `adjust` and `rolling` (FR-DICEX-48, §6.1 table C; amends
// FR-DICEX-04, -05, -08 b, e): the dice that will be rolled, highest face up, in the viewer's
// look. 3D: static stills drawn through a temporary arena of the page's one WebGL canvas into
// this area's own 2D canvas (`dicex-tray-preview`), so they keep the window's z-order; no loop.
// Else `DieShape` chips. Each die has a DOM mirror (`dicex-tray-die`): a button in `compose`
// (click removes one), a span otherwise. More than 12 dice → one die per term "×N".
// FR-DICEX-54: the dice area shrinks first: 40-px cells while every die fits the area, else 28,
// else "×N" (forced by room), else the area scrolls on its own (`stillSize`).
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

/** FR-DICEX-54: still cell sizes (px) and the gap between cells (`gap-1`). */
export type StillCell = 40 | 28;
export const CELL_GAP = 4;

/** The dice area's content box (CSS px), measured by the tray. */
export interface AreaBox {
  w: number;
  h: number;
}

const fitsIn = (cells: number, size: StillCell, area: AreaBox) => {
  const perRow = Math.max(1, Math.floor((area.w + CELL_GAP) / (size + CELL_GAP)));
  const rows = Math.ceil(cells / perRow);
  return rows * size + (rows - 1) * CELL_GAP <= area.h;
};

/**
 * FR-DICEX-54: the still size for `cells` cells (one per still, d100 = two, plus one per constant
 * / label) or `groupedCells` once grouped "×N". 40 while all fit; else 28; else grouped (40 or 28,
 * `grouped` = forced by room, not by > 12 dice); else grouped at 28 and the area scrolls.
 */
export function stillSize(
  o: { cells: number; groupedCells: number; byCount: boolean },
  area: AreaBox,
): { cell: StillCell; grouped: boolean; scroll: boolean } {
  if (!o.byCount) {
    for (const cell of [40, 28] as const) {
      if (fitsIn(o.cells, cell, area)) return { cell, grouped: false, scroll: false };
    }
  }
  const grouped = !o.byCount;
  for (const cell of [40, 28] as const) {
    if (fitsIn(o.groupedCells, cell, area)) return { cell, grouped, scroll: false };
  }
  return { cell: 28, grouped, scroll: true };
}

const CELL_BOX: Record<StillCell, string> = { 40: "h-10 min-w-10", 28: "h-7 min-w-7" };
const CELL_SIZE: Record<StillCell, string> = { 40: "size-10", 28: "size-7" };

/** One expression's dice and constant ("+5" after the dice). */
export interface TrayGroup {
  chips: TrayChip[];
  constant: number;
  /** FR-DICE-41: the control's slot label ("Slashing"); absent / null = none. */
  label?: string | null;
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
function stillCells(root: HTMLElement, canvas: HTMLCanvasElement): TrayStill[] {
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
  cell = 40,
}: {
  die: PreviewDie;
  render: "3d" | "chips";
  look: DiceLook;
  onRemove?: () => void;
  /** FR-DICEX-54: 40 or 28 px; chips `md` → `sm`. */
  cell?: StillCell;
}) {
  const text = `${die.sign === -1 ? "−" : ""}d${die.faces}`;
  const parts = render === "3d" ? stillParts(die.faces) : null;
  const body = (
    <>
      {parts ? (
        <>
          {die.sign === -1 && <span className="font-mono text-sm">−</span>}
          {parts.map((p) => (
            <span
              key={p}
              data-still={p}
              aria-hidden
              className={cn("block shrink-0", CELL_SIZE[cell])}
            />
          ))}
        </>
      ) : (
        <DieShape
          faces={die.faces}
          value={die.faces}
          look={look}
          negative={die.sign === -1}
          label={text}
          size={cell === 40 ? "md" : "sm"}
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
  const cls = cn("relative flex items-center justify-center rounded-md", CELL_BOX[cell]);
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
  cell,
}: {
  extraKey: string;
  dice: TrayExtraDice[];
  grouped: boolean;
  render: "3d" | "chips";
  look: DiceLook;
  cell: StillCell;
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
            <TrayDie key={j} die={{ ...c, term: i }} render={render} look={look} cell={cell} />
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
  area,
}: {
  request: TrayRequest;
  groups: TrayGroup[];
  /** The previewed mode (FR-DICEX-08 e), for the extras' hooks. */
  mode: RollMode;
  /** `compose`: a click on an untagged die removes one of its term. */
  onRemove?: (term: number) => void;
  /** `rolling`: the preview stays, dimmed. */
  dimmed?: boolean;
  /** FR-DICEX-54: the dice area's content box; unknown (not measured yet) → 40 px, as built. */
  area?: AreaBox | null;
}) {
  const extras = useExtraDice(request, mode);
  const look = useOwnLook();
  const { display } = useDiceSettings();
  const chunk = useChunk3d();
  const [failed, setFailed] = useState(false);
  const [waited, setWaited] = useState(false);
  const render = trayPreviewMode(display, chunk, failed);
  useEffect(() => trayWantsChunk(display, dice3d), [display]);

  const count =
    groups.reduce((n, g) => n + g.chips.length, 0) +
    extras.reduce((n, x) => n + extraChips(x.dice).length, 0);
  const byCount = count > GROUP_OVER;
  const cellsOf = (g: boolean) =>
    groups.reduce(
      (n, x) =>
        n +
        previewDice(x.chips, g).reduce((k, d) => k + (stillParts(d.faces)?.length ?? 1), 0) +
        (x.constant !== 0 ? 1 : 0) +
        (x.label ? 1 : 0),
      0,
    ) +
    // An extra's text ("MOD +1d4") takes about two cells.
    extras.reduce((n, x) => n + x.dice.length * 2 + previewDice(extraChips(x.dice), g).length, 0);
  const fit = area
    ? stillSize({ cells: cellsOf(byCount), groupedCells: cellsOf(true), byCount }, area)
    : { cell: 40 as const, grouped: false, scroll: false };
  const grouped = byCount || fit.grouped;
  const cell = fit.cell;
  const dice = useMemo(() => groups.map((g) => previewDice(g.chips, grouped)), [groups, grouped]);

  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Redraw when the dice, tags, look or the area's size change; one draw each, no loop.
  const drawKey = JSON.stringify([dice, extras, grouped, cell, look]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraws on `drawKey`
  useLayoutEffect(() => {
    const mod = dice3d.module();
    const el = root.current;
    const c = canvas.current;
    if (render !== "3d" || !mod || !el || !c) return;
    const layer = diceLayerHost.current;
    if (!layer) {
      // The dice layer mounting in this same commit (display just turned 3D): look once more.
      if (waited) return setFailed(true);
      const t = setTimeout(() => setWaited(true), 0);
      return () => clearTimeout(t);
    }
    const paint = () => {
      try {
        mod.drawTrayStills(layer, c, stillCells(el, c), look);
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
  }, [render, drawKey, waited]);

  return (
    <div
      ref={root}
      className={cn(
        "relative flex w-full flex-wrap items-center gap-1",
        cell === 40 ? "min-h-10" : "min-h-7",
        dimmed && "opacity-50",
      )}
    >
      <canvas
        // A fresh canvas per mode: chips never sit over an old still.
        key={render}
        ref={canvas}
        data-testid="dicex-tray-preview"
        data-mode={render}
        data-cell={cell}
        {...(fit.grouped && { "data-grouped": "true" })}
        {...(fit.scroll && { "data-scroll": "true" })}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      {groups.map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one group per expression position
        <span key={i} className="flex flex-wrap items-center gap-1">
          {i > 0 && <span className="px-1 text-muted-foreground">·</span>}
          {g.label && (
            <span
              data-testid="dicex-tray-group-label"
              data-index={i}
              className="relative text-xs text-muted-foreground"
            >
              {g.label}
            </span>
          )}
          {(dice[i] ?? []).map((d, j) => (
            <TrayDie
              // biome-ignore lint/suspicious/noArrayIndexKey: one die per position
              key={j}
              die={d}
              render={render}
              look={look}
              cell={cell}
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
          cell={cell}
        />
      ))}
    </div>
  );
}
