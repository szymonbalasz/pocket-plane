// The roll popup stack (FR-DICEX-39–41; DICEX §7 "Roll popup"), a lazy chunk (≤ 8 KB gz) loaded
// at idle and portalled into the shell's toast region (players bottom-right, newest at the
// bottom; the DM top-centre, newest on top, clear of Initiative). A card per live frame (320 ×
// ≤ 190, §6.1 table B): one named row per entry (actor, label, its total with its markers at the
// right), ✕ and the gear on the first row, then the frame's dice in a line of 44 px cells
// (FR-DICEX-46: the big throw's dice flown in, a miniature tumbling into the cells on the dice
// layer's one canvas, or die-shape chips; ≤ 2 lines, then "+N"). Click → the Game log at the
// entry (FR-DICE-37). Sprint 5: each row's total waits for its entry's landing ("Rolling…"),
// chips blank till then (FR-DICEX-49, table E); only the popups that fit the region show
// (FR-DICEX-47). T5 (DM #347): the whole card × 1.4 (448 × ≤ 268, 62-px cells, bigger text),
// today's 320 px card only where the viewport can't hold it (`popupGeomAt`). Kit parity K1
// (FR-KIT-49): each row starts with the actor's Medallion and each total is a Result box with
// the log row's outcome (FR-KIT-44).
// State and timers live in `popups.ts`; nothing here is stored or sent.
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { isMeshDie, type ThrowDie } from "@shared/dice-extras/throw";
import { type RollOutcome, resultOutcome } from "@shared/dice-roll-log/row";
import { type GameLogEntryView, RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { EyeOffIcon, SettingsIcon, XIcon } from "lucide-react";
import {
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Medallion } from "../../components/kit/medallion";
import { ResultBox } from "../../components/kit/result-box";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { lazyChunk } from "../../lib/lazy-chunk";
import { cn } from "../../lib/utils";
import { colorHex } from "../campaign-management/colors";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import { focusLogEntry } from "../dice-roll-log/focus";
import { RollerName, rollerColorKey, useColorKeyOf } from "../dice-roll-log/name-color";
import { SHOWN_STACK_ID as NOTE_STACK_ID } from "../notifications/ToastRuntime";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { EDGE_GAP, TOP_BAR_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import { hardRects, useKeepOuts } from "../play-shell/keep-outs";
import type { ShellClient } from "../play-shell/registry";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import { reportShownStack, shownStacks, subscribeShownStack } from "../play-shell/toast-region";
import { arenaOf, DIE_WORLD } from "./arena";
import type { Rect } from "./dice3d/index";
import { FlatDie } from "./FlatDie";
import { useAllLanded, useHolding, useLanded } from "./landing";
import { diceLayerHost, rectOf } from "./layer-host";
import { dice3d, whenChunk } from "./lazy3d";
import {
  CELL_LINES,
  cellTag,
  dmColumnTop,
  dmPopupClear,
  dmStackAt,
  linesH,
  type PopupCell,
  type PopupGeom,
  type PopupItem,
  type PopupLine,
  type PopupRow,
  pipClip,
  popupGeomAt,
  popupHeight,
  popupItemLabel,
  popupLine,
  popupOfferText,
  popupRows,
  popupsThatFit,
  ROWS_SHOWN,
  shownPopupStack,
} from "./popup-logic";
import {
  CELL_STILL_PAD,
  MORE_CELL,
  pipModeOf,
  type RollPopup,
  registerPopupCell,
  rollPopups,
  useRollPopups,
} from "./popups";
import type { SettingsPane } from "./SettingsPanel";
import { type DisplaySetting, is3dDisplay } from "./settings";
import { useDiceExtras } from "./store";
import { MINIATURE_MS } from "./timing";

const SettingsPanel = lazyChunk(
  () => import("./SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
  "inline",
);

/** True one frame after mount: flat chips fade in (≤ 300 ms). */
function useShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return shown;
}

/** Modal dialogs and popovers on the page: no PiP pixel under them (FR-DICEX-41, B26). */
function coverRects(): Rect[] {
  const out: Rect[] = [];
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    const r = rectOf(el);
    if (r && r.w > 0 && r.h > 0) out.push(r);
  }
  return out;
}

/** Copy `src` into `canvas`, contained and centred (a hand-off still). */
function paint(canvas: HTMLCanvasElement | null, src: HTMLCanvasElement) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  const k = Math.min(1, canvas.width / src.width, canvas.height / src.height);
  const w = src.width * k;
  const h = src.height * k;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

/** The popup's text and controls at each card size (T5: × 1.4 on the big card). */
const TEXT = {
  base: {
    row: "text-sm",
    rolling: "text-xs",
    total: "h-5 min-w-7 text-sm",
    natural: "text-xs",
    badge: "text-[10px]",
    tag: "text-[9px]",
    more: "text-sm",
    icon: "size-3.5",
    button: "size-5",
  },
  big: {
    row: "text-xl",
    rolling: "text-[17px]",
    total: "h-7 min-w-10 text-xl",
    natural: "text-[17px]",
    badge: "text-sm",
    tag: "text-[13px]",
    more: "text-xl",
    icon: "size-5",
    button: "size-7",
  },
} as const;
const textOf = (g: PopupGeom) => (g.k > 1 ? TEXT.big : TEXT.base);

/** FR-DICEX-46 a: a handed-off die's still in its cell (the flight reads the cell's rect). */
function StillCanvas({ still, g }: { still: HTMLCanvasElement | undefined; g: PopupGeom }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (still) paint(canvas.current, still);
  }, [still]);
  // The still overhangs its cell by the die's margin in the copied box.
  const out = (g.cell * (CELL_STILL_PAD - 1)) / 2;
  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute"
      style={{
        left: -out,
        top: -out,
        width: g.cell * CELL_STILL_PAD,
        height: g.cell * CELL_STILL_PAD,
      }}
    />
  );
}

/**
 * FR-DICEX-46 b: a miniature die spans its cell (simulation px per world unit), and every
 * miniature tumbles in the same arena (a line wide, three lines deep: room to roll in from
 * below), whatever its line count; then into its cells.
 */
const miniOf = (g: PopupGeom) => ({
  perUnit: g.cell / DIE_WORLD,
  arena: arenaOf({ w: g.lineW, h: linesH(CELL_LINES + 1, g) }, g.cell),
});

/**
 * FR-DICEX-46 b: the miniature, on the dice layer's one canvas over the line box (same seed),
 * each die tumbling into its cell (≤ 1.2 s), scissored each frame to the card's visible rect
 * minus dialogs; at rest its pixels are copied into this canvas in the same task. No 3D here or
 * now → chips.
 */
function Miniature({
  p,
  cells,
  card,
  display,
  g,
}: {
  p: RollPopup;
  cells: readonly PopupCell[];
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
  g: PopupGeom;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState<Record<string, number> | null>(null);
  const input = useRef({ p, cells, display, g });
  input.current = { p, cells, display, g };
  const key = cells.map((c) => c.die.key).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per dice set (`key`)
  useEffect(() => {
    const { p: pop, cells: cs, display: shown, g: geom } = input.current;
    const mini = miniOf(geom);
    const chips = () => rollPopups.fallback(pop.id, "play", "chips");
    if (!is3dDisplay(shown)) return chips();
    let stop: (() => void) | null = null;
    const cancel = whenChunk(dice3d, (ready) => {
      const mod = dice3d.module();
      const layer = diceLayerHost.current;
      const start = rectOf(box.current);
      if (!ready || !mod || !layer || !start) return chips();
      const area = () => rectOf(box.current) ?? start;
      const vp = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight });
      try {
        const h = mod.playThrow({
          layer,
          rect: area,
          clip: () => pipClip(area(), [rectOf(card.current) ?? area(), vp()], coverRects()),
          arena: mini.arena,
          view: { x: start.w / 2 / mini.perUnit, z: start.h / 2 / mini.perUnit },
          cells: cs.map((c) => ({ x: c.x + geom.cell / 2, y: c.y + geom.cell / 2 })),
          maxMs: MINIATURE_MS,
          shadows: false,
          seed: mod.seedOf(pop.t.seedId),
          dice: cs.map(({ die: d }) => ({
            key: d.key,
            shape: d.shape as NonNullable<ThrowDie["shape"]>,
            ...(d.d100 && { d100: d.d100 }),
            value: d.value as number,
            kept: d.kept,
            look: pop.looks[d.entryId] ?? STYLE_LOOK.ivory,
          })),
          onRest: (info) => {
            setSettled(info.settled);
            rollPopups.rested(pop.id, "play");
          },
          onLost: chips,
          onStill: (s) => {
            // Same task as the rest frame: place the copied pixels where they were drawn.
            const c = canvas.current;
            const at = rectOf(box.current);
            const ctx = c?.getContext("2d");
            if (!c || !ctx || !at) return;
            const ratio = s.canvas.width / Math.max(1, s.rect.w);
            c.width = Math.round(at.w * ratio);
            c.height = Math.round(at.h * ratio);
            ctx.drawImage(s.canvas, (s.rect.x - at.x) * ratio, (s.rect.y - at.y) * ratio);
          },
        });
        stop = () => h.stop();
      } catch {
        chips();
      }
    });
    return () => {
      cancel();
      stop?.();
    };
  }, [key]);
  return (
    <span ref={box} className="absolute inset-0">
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {cells.map(({ die: d }) => (
        <span
          key={d.key}
          data-testid="dicex-throw-die"
          data-entry-id={d.entryId}
          data-faces={d.faces}
          data-value={d.value ?? ""}
          data-kept={d.kept}
          data-flat={false}
          data-style={(p.looks[d.entryId] ?? STYLE_LOOK.ivory).style}
          data-material={(p.looks[d.entryId] ?? STYLE_LOOK.ivory).material}
          {...(settled && { "data-settled": settled[d.key] ?? "" })}
          className="sr-only"
        />
      ))}
    </span>
  );
}

/** What a cell draws: a chip (flat, or not a mesh die), a hand-off still, or the miniature's. */
type CellDraw = "chip" | "handoff" | "play";

/** FR-DICEX-46: one die's cell (62 px, T5); `data-value` once its entry landed (FR-DICEX-49). */
function Cell({
  p,
  cell,
  draw,
  held,
  shown,
  g,
}: {
  p: RollPopup;
  cell: PopupCell;
  draw: CellDraw;
  held: boolean;
  shown: boolean;
  g: PopupGeom;
}) {
  const d = cell.die;
  const tag = cellTag(d);
  const look = p.looks[d.entryId];
  const el = (
    <span
      ref={(e) => registerPopupCell(p.id, d.key, e)}
      data-testid="dicex-popup-cell"
      data-entry-id={d.entryId}
      data-line={cell.line}
      data-index={cell.index}
      data-faces={d.faces}
      data-kept={d.kept}
      data-offered={d.offered === true}
      {...(!held && { "data-value": d.value ?? "" })}
      className={cn(
        "absolute flex items-center justify-center rounded-md",
        d.offered && draw !== "chip" && "border border-dashed border-muted-foreground",
      )}
      style={{ left: cell.x, top: cell.y, width: g.cell, height: g.cell }}
    >
      {draw === "chip" ? (
        <span
          className={cn("transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}
        >
          <FlatDie die={d} look={look} size="lg" scale={g.k} settled flat blank={held} />
        </span>
      ) : (
        draw === "handoff" && <StillCanvas still={p.stills[d.key]} g={g} />
      )}
      {tag && (
        <span
          className={cn(
            "absolute -bottom-1 left-0 w-full truncate rounded bg-background/80 px-0.5 text-center leading-tight text-muted-foreground",
            textOf(g).tag,
          )}
        >
          {tag.tag}
        </span>
      )}
    </span>
  );
  return tag ? <Tooltip content={tag.full}>{el}</Tooltip> : el;
}

/**
 * FR-DICEX-46: the frame's dice in a line of cells (≤ 2 lines, then 11 + "+N"); hand-off
 * stills, the miniature or chips fill the same cells. Click → the Game log at the entry; "+N" →
 * at the first hidden die's entry (FR-DICE-37).
 */
function Pip({
  p,
  line,
  card,
  display,
  g,
}: {
  p: RollPopup;
  line: PopupLine;
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
  g: PopupGeom;
}) {
  const shown = useShown();
  const holding = useHolding();
  const mode = pipModeOf(p);
  const { handoff, play } = p.parts;
  const live = (d: ThrowDie, part?: { ids: string[]; chips: boolean }) =>
    part !== undefined && !part.chips && part.ids.includes(d.entryId) && isMeshDie(d);
  const drawOf = (d: ThrowDie): CellDraw =>
    live(d, handoff) ? "handoff" : live(d, play) ? "play" : "chip";
  const mini = line.cells.filter((c) => drawOf(c.die) === "play");
  const more = line.more;
  return (
    <div
      data-testid="dicex-popup-pip"
      data-mode={mode}
      className="relative shrink-0"
      style={{ width: line.w, height: line.h + g.tag }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show in the Game log"
        className="absolute top-0 left-0 block"
        style={{ width: line.w, height: line.h }}
        onClick={() => focusLogEntry(p.id)}
      >
        {mini.length > 0 && <Miniature p={p} cells={mini} card={card} display={display} g={g} />}
        {line.cells.map((c) => (
          <Cell
            key={c.die.key}
            p={p}
            cell={c}
            draw={drawOf(c.die)}
            held={holding.has(c.die.entryId)}
            shown={shown}
            g={g}
          />
        ))}
      </button>
      {more && (
        <button
          type="button"
          ref={(e) => registerPopupCell(p.id, MORE_CELL, e)}
          data-testid="dicex-popup-more"
          data-value={more.n}
          data-entry-id={more.entryId}
          aria-label={`${more.n} more dice: show in the Game log`}
          className={cn(
            "absolute flex items-center justify-center rounded-md border font-semibold text-muted-foreground tabular-nums hover:bg-accent",
            textOf(g).more,
          )}
          style={{ left: more.x, top: more.y, width: g.cell, height: g.cell }}
          onClick={() => focusLogEntry(more.entryId)}
        >
          +{more.n}
        </button>
      )}
    </div>
  );
}

/**
 * One item's total and markers, as the line (FR-DICE-20, -29). FR-KIT-49: the total is a Result
 * box (`sm`) with the log row's outcome (FR-KIT-44); natural, physical and offered stay as text.
 */
function Total({ item, g, outcome }: { item: PopupItem; g: PopupGeom; outcome: RollOutcome }) {
  const t = textOf(g);
  return (
    <span className="flex shrink-0 items-center gap-x-1 whitespace-nowrap">
      <ResultBox
        data-testid="dicex-popup-total"
        size="sm"
        value={item.total}
        outcome={outcome}
        className={t.total}
      />
      {item.natural && <span className={cn("font-medium", t.natural)}>{item.natural}</span>}
      {item.physical && (
        <span className={cn("rounded border px-1 text-muted-foreground", t.badge)}>physical</span>
      )}
      {item.offered.map((o) => (
        <span key={o.key} className={cn("text-muted-foreground", t.badge)}>
          {popupOfferText(o)}
        </span>
      ))}
    </span>
  );
}

const ROLLING_TEXT = "Rolling…";

/** FR-DICEX-40 / -47: actor, label, the row's own total at its right ("Rolling…" till landed). */
function Row({ row, e, g }: { row: PopupRow; e: GameLogEntryView | undefined; g: PopupGeom }) {
  const landed = useLanded(row.entryId);
  const t = textOf(g);
  const keyOf = useColorKeyOf();
  const key = e ? rollerColorKey(keyOf, e) : null;
  // FR-KIT-49: each item's outcome as its log row's box (FR-KIT-44), by roll id; K8: an attack
  // entry's rolls after its to-hit are its damage.
  const outcomes = useMemo(() => {
    const out = new Map<string, RollOutcome>();
    const p = e ? RollEntryPayload.safeParse(e.payload) : null;
    const attack = e?.category === "attack";
    for (const [k, i] of (p?.success ? p.data : []).entries()) {
      out.set(i.rollId, resultOutcome(i, e?.category, attack && k > 0));
    }
    return out;
  }, [e]);
  return (
    <button
      type="button"
      data-testid="dicex-popup-row"
      data-record-id={row.entryId}
      data-landed={landed}
      className={cn("flex w-full shrink-0 items-center gap-1.5 text-left", t.row)}
      style={{ height: g.row }}
      onClick={() => focusLogEntry(row.entryId)}
    >
      {row.hidden && (
        <EyeOffIcon aria-label="Hidden from players" className={cn("shrink-0", t.icon)} />
      )}
      {/* FR-KIT-49: the actor's initial on its name colour (FR-KIT-41). */}
      <Medallion name={row.actor} colour={key ? colorHex(key) : null} size="sm" />
      <RollerName entryId={row.entryId} name={row.actor} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {row.items.map(popupItemLabel).join(" · ")}
      </span>
      {landed ? (
        row.items.map((i) => (
          <Total key={i.key} item={i} g={g} outcome={outcomes.get(i.key) ?? "plain"} />
        ))
      ) : (
        <span className={cn("shrink-0 text-muted-foreground", t.rolling)}>{ROLLING_TEXT}</span>
      )}
    </button>
  );
}

function Gear({ g }: { g: PopupGeom }) {
  const [pane, setPane] = useState<SettingsPane>("settings");
  const t = textOf(g);
  return (
    <Popover onOpenChange={(o) => !o && setPane("settings")}>
      <PopoverTrigger asChild>
        <Button
          data-testid="dicex-popup-settings"
          size="icon"
          variant="ghost"
          className={cn("shrink-0", t.button)}
          aria-label="Dice settings"
        >
          <SettingsIcon className={t.icon} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("flex flex-col gap-3", pane === "look" ? "w-72" : "w-80")}
      >
        <Suspense fallback={null}>
          <SettingsPanel pane={pane} onPane={setPane} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

/** The card's padding, its 1 px border included: `pad` top and bottom (table B), `pad` + 2 sides. */
const cardPad = (g: PopupGeom) => ({ paddingBlock: g.pad - 1, paddingInline: g.pad + 1 });

/** A popup's rows, dice line and height (FR-DICEX-46, -47). */
function layoutOf(p: RollPopup, g: PopupGeom) {
  const rows = popupRows(p.entries);
  const line = popupLine(p.t.dice, p.t.more, g);
  return { rows, line, h: popupHeight(rows.length, line.lines, g) };
}

function Card({ p, display, g }: { p: RollPopup; display: DisplaySetting; g: PopupGeom }) {
  const card = useRef<HTMLElement>(null);
  const { rows, line } = useMemo(() => layoutOf(p, g), [p, g]);
  const t = textOf(g);
  const landed = useAllLanded(p.t.entryIds);
  // FR-DICEX-94 (BL-89): held only after a real pointer move on the card since it showed (a
  // popup that opens under a resting pointer isn't), or focus inside; the flags start clear on
  // every mount and go with the card, so a stale one never holds it.
  useLayoutEffect(() => {
    const el = card.current;
    rollPopups.mounted(p.id, () => el?.matches(":hover") === true);
    return () => rollPopups.mounted(p.id, null);
  }, [p.id]);
  return (
    <section
      ref={card}
      data-testid="dicex-popup"
      data-record-id={p.id}
      data-count={rows.length}
      data-dice={p.t.dice.length + p.t.more}
      data-shown={line.cells.length}
      data-hidden={p.hidden}
      data-state={p.state}
      data-landed={landed}
      data-scale={g.k}
      aria-label="Roll"
      className={cn(
        "pointer-events-auto flex shrink-0 flex-col overflow-hidden rounded-lg border text-popover-foreground shadow-lg transition-opacity duration-150",
        p.hidden ? "bg-muted" : "bg-popover",
        p.state === "closing" ? "opacity-0" : "opacity-100",
      )}
      style={{ width: g.w, maxHeight: g.maxH, gap: g.rowsGap, ...cardPad(g) }}
      onPointerMove={(e) => {
        if (e.movementX !== 0 || e.movementY !== 0) rollPopups.pointer(p.id, true);
      }}
      onPointerLeave={() => rollPopups.pointer(p.id, false)}
      onFocus={() => rollPopups.focus(p.id, true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          rollPopups.focus(p.id, false);
        }
      }}
    >
      <header className="flex shrink-0 items-start gap-1">
        {/* Rows beyond 3 scroll inside (§6.1 table B). */}
        <div
          className="flex min-w-0 flex-1 flex-col overflow-y-auto"
          style={{ maxHeight: ROWS_SHOWN * g.row }}
        >
          {rows.map((r) => (
            <Row key={r.entryId} row={r} e={p.entries.find((x) => x.id === r.entryId)} g={g} />
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-0.5" style={{ height: g.row }}>
          <Gear g={g} />
          <Button
            data-testid="dicex-popup-close"
            size="icon"
            variant="ghost"
            className={cn("shrink-0", t.button)}
            aria-label="Close"
            onClick={() => rollPopups.close(p.id)}
          >
            <XIcon className={t.icon} />
          </Button>
        </span>
      </header>
      {line.lines > 0 && <Pip p={p} line={line} card={card} display={display} g={g} />}
    </section>
  );
}

/** FR-DICEX-09: the pending card's height (one row). */
const pendingH = (g: PopupGeom) => popupHeight(1, 0, g);

/** FR-DICEX-09: the own roll in flight, until its entry arrives (or 3 s). */
function PendingCard({ g }: { g: PopupGeom }) {
  return (
    <section
      data-testid="dicex-popup"
      data-state="rolling"
      data-pending="true"
      aria-label="Rolling"
      className={cn(
        "pointer-events-auto flex shrink-0 items-center rounded-lg border bg-popover text-muted-foreground shadow-lg",
        textOf(g).row,
      )}
      style={{ width: g.w, height: pendingH(g), ...cardPad(g) }}
    >
      Rolling…
    </section>
  );
}

/** FR-NOTE-32 for the DM's stack: the open Initiative window's rendered rect, else null. */
function useInitiativeRect(dm: boolean): Rect | null {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  const measured = useContentHeights();
  return useMemo(() => {
    if (!dm) return null;
    const win = windows.filter((w) => w.kind === INITIATIVE_KIND && w.state === "open");
    return renderedWindowRects(win, registry, available, vp, measured)[0] ?? null;
  }, [dm, windows, registry, available, vp, measured]);
}

/** Rect lists equal to the pixel (the observer re-measures on every style change). */
const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i];
    return o !== undefined && r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h;
  });

/**
 * FR-CBT-75 for the DM's stack: the open non-modal dialogs' rects (the combat popup, which opens
 * where its toast was and may then be dragged, FR-CBT-76), followed while the stack shows.
 */
function useNonModalRects(dm: boolean, active: boolean): readonly Rect[] {
  const [rects, setRects] = useState<readonly Rect[]>([]);
  useEffect(() => {
    if (!dm || !active) {
      setRects((r) => (r.length === 0 ? r : []));
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const next: Rect[] = [];
      for (const el of document.querySelectorAll('[role="dialog"][aria-modal="false"]')) {
        const r = rectOf(el);
        if (r && r.w > 0 && r.h > 0) next.push(r);
      }
      setRects((r) => (sameRects(r, next) ? r : next));
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [dm, active]);
  return rects;
}

/** The DM popup stack's id in play-shell's shown stack (FR-SHELL-59). */
const SHOWN_ID = "dicex.popups";

export function RollPopupStack({
  client,
  display,
}: {
  client: ShellClient;
  /** The effective display (FR-DICEX-32). */
  display: DisplaySetting;
}) {
  const popups = useRollPopups((s) => s.popups);
  const pending = useDiceExtras((s) => s.pending);
  const dm = client === "dm";
  const vp = useViewport();
  // T5: the big card where the viewport holds it, else today's.
  const g = popupGeomAt(client, vp);
  const initiative = useInitiativeRect(dm);
  const dialogs = useNonModalRects(dm, popups.length > 0 || pending);
  // FR-DICEX-55: the DM stack never covers a tool bar (play-shell's hard keep-outs).
  const keepOuts = useKeepOuts(client);
  // FR-DICEX-55: nor the DM's other shown stacks (the notification toasts, FR-SHELL-59).
  const reports = useSyncExternalStore(subscribeShownStack, shownStacks, shownStacks);
  const stack = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, h: 0 });
  // BL-118: re-measured after every commit, before the paint (the cards, the toast reports).
  useLayoutEffect(() => {
    const el = stack.current;
    const top = Math.round(el?.parentElement?.getBoundingClientRect().top ?? 0);
    const h = Math.round(el?.getBoundingClientRect().height ?? 0);
    setBox((b) => (b.top === top && b.h === h ? b : { top, h }));
  });
  const clear = dmPopupClear(
    initiative,
    dialogs,
    dm ? hardRects(keepOuts) : [],
    dm ? reports : new Map(),
    SHOWN_ID,
  );
  // BL-118: from the toast stack's resting report, so the column moves only when a popup arrives
  // or leaves or that stack settles elsewhere, never on a popup's own rolling → rest re-render.
  const start = dmColumnTop(reports.get(NOTE_STACK_ID)?.h ?? 0);
  const at = dmStackAt(vp, start, { w: g.w, h: box.h }, clear);
  // FR-DICEX-47 short screens: only the popups that fit the region (newest first; the oldest
  // drops), never past the viewport's bottom (DM) or over the top bar (players).
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const room = dm ? vp.h - EDGE_GAP - r.top : r.bottom - TOP_BAR_H - EDGE_GAP;
    const open = popups.filter((p) => p.state !== "closing");
    const heights = open.map((p) => layoutOf(p, g).h).reverse();
    if (pending) heights.unshift(pendingH(g));
    const keep = Math.max(1, popupsThatFit(heights, room) - (pending ? 1 : 0));
    if (open.length > keep) rollPopups.drop(open.slice(0, open.length - keep).map((p) => p.id));
  });
  // FR-SHELL-59: the DM stack's rendered rect for the Fit (FR-MAP-80); null when empty or gone.
  useLayoutEffect(() => reportShownStack(SHOWN_ID, shownPopupStack(dm, rectOf(stack.current))));
  useEffect(() => () => reportShownStack(SHOWN_ID, null), []);
  if (popups.length === 0 && !pending) return null;
  // Newest nearest the region's anchor: the DM's top, the players' bottom.
  const cards = popups.map((p) => <Card key={p.id} p={p} display={display} g={g} />);
  if (pending) cards.push(<PendingCard key="pending" g={g} />);
  if (!dm) {
    // The region's column is the toast box's width: a wider card grows to the left of it, its
    // right edge on the region's.
    return (
      <div ref={stack} className="flex flex-col items-end gap-2">
        {cards}
      </div>
    );
  }
  // BL-118: fixed at its viewport spot, not offset from the region row: that row follows the
  // toast stack's height a frame later (play-shell's `ShellToaster`), which moved the column
  // with it until the next re-measure (sim-15: 388 → 442 → 388 under a new alert toast).
  return (
    <div ref={stack} className="fixed flex flex-col gap-2" style={{ left: at.left, top: at.top }}>
      {cards.reverse()}
    </div>
  );
}
