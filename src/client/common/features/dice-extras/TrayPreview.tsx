// The tray's dice area in `compose`, `adjust` and `rolling` (FR-DICEX-48, §6.1 table C; amends
// FR-DICEX-04, -05, -08 b, e): the dice that will be rolled, highest face up, in the viewer's
// look. 3D: static stills drawn through a temporary arena of the page's one WebGL canvas into
// this area's own 2D canvas (`dicex-tray-preview`), so they keep the window's z-order; no loop.
// Else `DieShape` chips. Each die has a DOM mirror (`dicex-tray-die`): a button in `compose`
// (click removes one), a span otherwise. More than 12 dice → one die per term "×N".
// FR-DICEX-54: the dice area shrinks first: 40-px cells while every die fits the area, else 28,
// else "×N" (forced by room), else the area scrolls on its own (`stillSize`).
// FR-DICEX-96 (DM #343): cells, chips and their numbers scale with the tray (`trayScale`: × 1 at
// the min, × 1.2 at the useful size, × 1.25 at the default); the steps stay 40 / 28 (`data-cell`).
// Sprint 15 (#385): an editable `adjust` removes dice too (FR-DICEX-97) except a locked die (the
// attack's d20, a damage roll's last die: a span with its Tooltip text); a damage roll shows one
// row per die group: its type Select, its dice, its "+" and modifier (FR-DICEX-101, -105).
import type { DiceLook } from "@shared/dice-extras/looks";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  scaledFont,
  scaledPx,
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

const fitsIn = (cells: number, step: StillCell, area: AreaBox, scale: number) => {
  const size = scaledPx(step, scale);
  const perRow = Math.max(1, Math.floor((area.w + CELL_GAP) / (size + CELL_GAP)));
  const rows = Math.ceil(cells / perRow);
  return rows * size + (rows - 1) * CELL_GAP <= area.h;
};

/**
 * FR-DICEX-105: a group row's own controls (type 96 px, "+" 24, modifier 48, three gaps): the row's
 * dice wrap in what is left.
 */
export const ROW_CHROME_PX = 180;

/** FR-DICEX-105: `rows` (each row's cells) stacked, each wrapping beside its controls. */
const rowsFitIn = (rows: readonly number[], step: StillCell, area: AreaBox, scale: number) => {
  const size = scaledPx(step, scale);
  const room = area.w - ROW_CHROME_PX + CELL_GAP;
  const perRow = Math.max(1, Math.floor(room / (size + CELL_GAP)));
  const h = rows.reduce((n, cells) => {
    const lines = Math.max(1, Math.ceil(cells / perRow));
    return n + lines * size + (lines - 1) * CELL_GAP;
  }, 0);
  return h + (rows.length - 1) * CELL_GAP <= area.h;
};

/**
 * FR-DICEX-54: the still size for `cells` cells (one per still, d100 = two, plus one per constant
 * / label) or `groupedCells` once grouped "×N". 40 while all fit; else 28; else grouped (40 or 28,
 * `grouped` = forced by room, not by > 12 dice); else grouped at 28 and the area scrolls. Each
 * step is drawn at `scale` (FR-DICEX-96: 40 → 50 px at × 1.25). FR-DICEX-105: with `rows` (each
 * group's cells, then grouped), the groups stack instead of flowing.
 */
export function stillSize(
  o: {
    cells: number;
    groupedCells: number;
    byCount: boolean;
    rows?: { cells: readonly number[]; groupedCells: readonly number[] };
  },
  area: AreaBox,
  scale = 1,
): { cell: StillCell; grouped: boolean; scroll: boolean } {
  const fits = (grouped: boolean, cell: StillCell) => {
    if (o.rows) {
      return rowsFitIn(grouped ? o.rows.groupedCells : o.rows.cells, cell, area, scale);
    }
    return fitsIn(grouped ? o.groupedCells : o.cells, cell, area, scale);
  };
  if (!o.byCount) {
    for (const cell of [40, 28] as const) {
      if (fits(false, cell)) return { cell, grouped: false, scroll: false };
    }
  }
  const grouped = !o.byCount;
  for (const cell of [40, 28] as const) {
    if (fits(true, cell)) return { cell, grouped, scroll: false };
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
  /** FR-DICEX-101: the group's type Select, in place of the label; the group is its own row. */
  lead?: ReactNode;
  /** FR-DICEX-105: a row's controls after its dice ("+", the modifier). */
  trail?: ReactNode;
  /** FR-DICEX-105: a new group's text while it has no dice yet. */
  hint?: string;
  /** FR-DICEX-97: the term whose die a click may not remove, and why (its Tooltip). */
  locked?: { term: number; tip: string } | null;
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
  scale = 1,
  tip,
}: {
  die: PreviewDie;
  render: "3d" | "chips";
  look: DiceLook;
  onRemove?: () => void;
  /** FR-DICEX-54: 40 or 28 px; chips `md` → `sm`. */
  cell?: StillCell;
  /** FR-DICEX-96: the tray's dice scale (× 1 = `cell` px, drawn by the classes). */
  scale?: number;
  /** FR-DICEX-97: a locked die's reason (no remove), as its title. */
  tip?: string;
}) {
  const text = `${die.sign === -1 ? "−" : ""}d${die.faces}`;
  const parts = render === "3d" ? stillParts(die.faces) : null;
  const px = scaledPx(cell, scale);
  const box = scale === 1 ? undefined : { height: px, minWidth: px };
  const body = (
    <>
      {parts ? (
        <>
          {die.sign === -1 && (
            <span className="font-mono text-sm" style={scaledFont(14, scale)}>
              −
            </span>
          )}
          {parts.map((p) => (
            <span
              key={p}
              data-still={p}
              aria-hidden
              className={cn("block shrink-0", CELL_SIZE[cell])}
              style={scale === 1 ? undefined : { width: px, height: px }}
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
          scale={scale}
        />
      )}
      {die.tag && (
        <span
          className="absolute -top-1.5 -right-1.5 rounded bg-primary px-1 text-[9px] leading-tight text-primary-foreground"
          style={scaledFont(9, scale)}
        >
          {die.tag}
        </span>
      )}
      {die.group && (
        <span
          className="absolute -right-1.5 -bottom-1.5 rounded bg-secondary px-1 font-mono text-[10px] leading-tight"
          style={scaledFont(10, scale)}
        >
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
    ...(tip && { "data-locked": "true", title: tip }),
  };
  const cls = cn("relative flex items-center justify-center rounded-md", CELL_BOX[cell]);
  return onRemove ? (
    <button
      type="button"
      {...attrs}
      style={box}
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
    <span {...attrs} className={cls} style={box}>
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
  scale,
}: {
  extraKey: string;
  dice: TrayExtraDice[];
  grouped: boolean;
  render: "3d" | "chips";
  look: DiceLook;
  cell: StillCell;
  scale: number;
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
          <span className="font-mono text-xs" style={scaledFont(12, scale)}>
            {d.label} {d.sign === -1 ? "−" : "+"}
            {d.count}d{d.faces}
          </span>
          {previewDice(extraChips([d]), grouped).map((c, j) => (
            <TrayDie
              // biome-ignore lint/suspicious/noArrayIndexKey: one die per position
              key={j}
              die={{ ...c, term: i }}
              render={render}
              look={look}
              cell={cell}
              scale={scale}
            />
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
  scale = 1,
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
  /** FR-DICEX-96: the tray's dice scale (`trayScale`). */
  scale?: number;
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
  const diceCells = (x: TrayGroup, g: boolean) =>
    previewDice(x.chips, g).reduce((k, d) => k + (stillParts(d.faces)?.length ?? 1), 0);
  // An extra's text ("MOD +1d4") takes about two cells.
  const extraCells = (g: boolean) =>
    extras.reduce((n, x) => n + x.dice.length * 2 + previewDice(extraChips(x.dice), g).length, 0);
  const cellsOf = (g: boolean) =>
    groups.reduce(
      (n, x) => n + diceCells(x, g) + (x.constant !== 0 ? 1 : 0) + (x.label ? 1 : 0),
      0,
    ) + extraCells(g);
  // FR-DICEX-105: damage groups stack, one row each (extras on a line of their own).
  const rowCells = (g: boolean) => [
    ...groups.map((x) => diceCells(x, g)),
    ...(extraCells(g) > 0 ? [extraCells(g)] : []),
  ];
  const stacked = groups.some((g) => g.lead);
  const fit = area
    ? stillSize(
        {
          cells: cellsOf(byCount),
          groupedCells: cellsOf(true),
          byCount,
          ...(stacked ? { rows: { cells: rowCells(byCount), groupedCells: rowCells(true) } } : {}),
        },
        area,
        scale,
      )
    : { cell: 40 as const, grouped: false, scroll: false };
  const grouped = byCount || fit.grouped;
  const cell = fit.cell;
  const dice = useMemo(() => groups.map((g) => previewDice(g.chips, grouped)), [groups, grouped]);

  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Redraw when the dice, tags, look, what sits beside them or the area's size change (a move
  // without a resize would leave the stills behind); one draw each, no loop.
  const beside = groups.map((g) => [g.constant, g.label ?? null, !!g.lead, g.hint ?? null]);
  const drawKey = JSON.stringify([dice, extras, beside, grouped, cell, scale, look]);
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
      style={scale === 1 ? undefined : { minHeight: scaledPx(cell, scale) }}
    >
      <canvas
        // A fresh canvas per mode: chips never sit over an old still.
        key={render}
        ref={canvas}
        data-testid="dicex-tray-preview"
        data-mode={render}
        data-cell={cell}
        data-px={scaledPx(cell, scale)}
        {...(fit.grouped && { "data-grouped": "true" })}
        {...(fit.scroll && { "data-scroll": "true" })}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      {groups.map((g, i) => {
        const items = (dice[i] ?? []).map((d, j) => {
          const tip = g.locked && g.locked.term === d.term ? g.locked.tip : undefined;
          return (
            <TrayDie
              // biome-ignore lint/suspicious/noArrayIndexKey: one die per position
              key={j}
              die={d}
              render={render}
              look={look}
              cell={cell}
              scale={scale}
              {...(tip ? { tip } : {})}
              onRemove={onRemove && !d.tag && !tip ? () => onRemove(d.term) : undefined}
            />
          );
        });
        if (g.lead) {
          // FR-DICEX-105: a group's row: type, dice (they wrap in the middle), "+", modifier. The
          // columns stay put whatever the type's label or the dice do.
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per group position
            <span key={i} data-testid="dicex-tray-group" className="flex w-full items-center gap-1">
              {g.lead}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {items}
                {g.hint && (
                  <span
                    data-testid="dicex-tray-group-hint"
                    className="relative truncate text-xs text-muted-foreground"
                    style={scaledFont(12, scale)}
                  >
                    {g.hint}
                  </span>
                )}
              </span>
              {g.trail}
            </span>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: one group per expression position
          <span key={i} className="flex flex-wrap items-center gap-1">
            {i > 0 && <span className="px-1 text-muted-foreground">·</span>}
            {g.label && (
              <span
                data-testid="dicex-tray-group-label"
                data-index={i}
                className="relative text-xs text-muted-foreground"
                style={scaledFont(12, scale)}
              >
                {g.label}
              </span>
            )}
            {items}
            {g.constant !== 0 && (
              <span
                className="relative font-mono text-sm text-muted-foreground"
                style={scaledFont(14, scale)}
              >
                {signed(g.constant)}
              </span>
            )}
          </span>
        );
      })}
      {extras.map((x) => (
        <ExtraDice
          key={x.key}
          extraKey={x.key}
          dice={x.dice}
          grouped={grouped}
          render={render}
          look={look}
          cell={cell}
          scale={scale}
        />
      ))}
    </div>
  );
}
