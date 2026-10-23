// The roll popup stack (FR-DICEX-39–41; DICEX §7 "Roll popup"), a lazy chunk (≤ 8 KB gz) loaded
// at idle and portalled into the shell's toast region (players bottom-right, newest at the
// bottom; the DM top-centre, newest on top, clear of Initiative). A card per live frame (320 ×
// ≤ 190, §6.1 table B): one named row per entry (actor, label, its total with its markers at the
// right), ✕ and the gear on the first row, then the frame's dice in a line of 44 px cells
// (FR-DICEX-46: the big throw's dice flown in, a miniature tumbling into the cells on the dice
// layer's one canvas, or die-shape chips; ≤ 2 lines, then "+N"). Click → the Game log at the
// entry (FR-DICE-37). Sprint 5: each row's total waits for its entry's landing ("Rolling…"),
// chips blank till then (FR-DICEX-49, table E); only the popups that fit the region show
// (FR-DICEX-47).
// State and timers live in `popups.ts`; nothing here is stored or sent.
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { isMeshDie, type ThrowDie } from "@shared/dice-extras/throw";
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
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { lazyChunk } from "../../lib/lazy-chunk";
import { cn } from "../../lib/utils";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import { focusLogEntry } from "../dice-roll-log/focus";
import { RollerName } from "../dice-roll-log/name-color";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { EDGE_GAP, TOP_BAR_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import { hardRects, useKeepOuts } from "../play-shell/keep-outs";
import type { ShellClient } from "../play-shell/registry";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import {
  ROLL_POPUP_H,
  ROLL_POPUP_W,
  reportShownStack,
  shownStacks,
  subscribeShownStack,
} from "../play-shell/toast-region";
import { arenaOf, DIE_WORLD } from "./arena";
import type { Rect } from "./dice3d/index";
import { FlatDie } from "./FlatDie";
import { useAllLanded, useHolding, useLanded } from "./landing";
import { diceLayerHost, rectOf } from "./layer-host";
import { dice3d, whenChunk } from "./lazy3d";
import {
  CELL_LINES,
  CELL_PX,
  cellTag,
  dmPopupClear,
  dmStackAt,
  LINE_W,
  linesH,
  MINI_DIE_PX,
  POPUP_PAD,
  type PopupCell,
  type PopupItem,
  type PopupLine,
  type PopupRow,
  pipClip,
  popupHeight,
  popupItemLabel,
  popupLine,
  popupOfferText,
  popupRows,
  popupsThatFit,
  ROW_H,
  ROWS_SHOWN,
  shownPopupStack,
  TAG_OVERHANG,
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

/** The still's overhang around its cell (the die's margin in the copied box, px). */
const STILL_OUT = (CELL_PX * (CELL_STILL_PAD - 1)) / 2;

/** FR-DICEX-46 a: a handed-off die's still in its cell (the flight reads the cell's rect). */
function StillCanvas({ still }: { still: HTMLCanvasElement | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (still) paint(canvas.current, still);
  }, [still]);
  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute"
      style={{
        left: -STILL_OUT,
        top: -STILL_OUT,
        width: CELL_PX * CELL_STILL_PAD,
        height: CELL_PX * CELL_STILL_PAD,
      }}
    />
  );
}

/** Simulation px per world unit of a miniature die (FR-DICEX-46 b). */
const MINI_PER_UNIT = MINI_DIE_PX / DIE_WORLD;
/**
 * Every miniature tumbles in the same arena (a line wide, three lines deep: room to roll in from
 * below), whatever its line count; then into its cells.
 */
const MINI_ARENA = arenaOf({ w: LINE_W, h: linesH(CELL_LINES + 1) }, MINI_DIE_PX);

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
}: {
  p: RollPopup;
  cells: readonly PopupCell[];
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState<Record<string, number> | null>(null);
  const input = useRef({ p, cells, display });
  input.current = { p, cells, display };
  const key = cells.map((c) => c.die.key).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per dice set (`key`)
  useEffect(() => {
    const { p: pop, cells: cs, display: shown } = input.current;
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
          arena: MINI_ARENA,
          view: { x: start.w / 2 / MINI_PER_UNIT, z: start.h / 2 / MINI_PER_UNIT },
          cells: cs.map((c) => ({ x: c.x + CELL_PX / 2, y: c.y + CELL_PX / 2 })),
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

/** FR-DICEX-46: one die's 44 px cell; `data-value` once its entry landed (FR-DICEX-49). */
function Cell({
  p,
  cell,
  draw,
  held,
  shown,
}: {
  p: RollPopup;
  cell: PopupCell;
  draw: CellDraw;
  held: boolean;
  shown: boolean;
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
      style={{ left: cell.x, top: cell.y, width: CELL_PX, height: CELL_PX }}
    >
      {draw === "chip" ? (
        <span
          className={cn("transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}
        >
          <FlatDie die={d} look={look} size="lg" settled flat blank={held} />
        </span>
      ) : (
        draw === "handoff" && <StillCanvas still={p.stills[d.key]} />
      )}
      {tag && (
        <span className="absolute -bottom-1 left-0 w-full truncate rounded bg-background/80 px-0.5 text-center text-[9px] leading-tight text-muted-foreground">
          {tag.tag}
        </span>
      )}
    </span>
  );
  return tag ? <Tooltip content={tag.full}>{el}</Tooltip> : el;
}

/**
 * FR-DICEX-46: the frame's dice in a line of 44 px cells (≤ 2 lines, then 11 + "+N"); hand-off
 * stills, the miniature or chips fill the same cells. Click → the Game log at the entry; "+N" →
 * at the first hidden die's entry (FR-DICE-37).
 */
function Pip({
  p,
  line,
  card,
  display,
}: {
  p: RollPopup;
  line: PopupLine;
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
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
      style={{ width: line.w, height: line.h + TAG_OVERHANG }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show in the Game log"
        className="absolute top-0 left-0 block"
        style={{ width: line.w, height: line.h }}
        onClick={() => focusLogEntry(p.id)}
      >
        {mini.length > 0 && <Miniature p={p} cells={mini} card={card} display={display} />}
        {line.cells.map((c) => (
          <Cell
            key={c.die.key}
            p={p}
            cell={c}
            draw={drawOf(c.die)}
            held={holding.has(c.die.entryId)}
            shown={shown}
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
          className="absolute flex items-center justify-center rounded-md border text-sm font-semibold text-muted-foreground tabular-nums hover:bg-accent"
          style={{ left: more.x, top: more.y, width: CELL_PX, height: CELL_PX }}
          onClick={() => focusLogEntry(more.entryId)}
        >
          +{more.n}
        </button>
      )}
    </div>
  );
}

/** One item's total and markers, as the line (FR-DICE-20, -29). */
function Total({ item }: { item: PopupItem }) {
  return (
    <span className="flex shrink-0 items-baseline gap-x-1 whitespace-nowrap">
      <strong data-testid="dicex-popup-total" className="text-sm tabular-nums">
        {item.total}
      </strong>
      {item.natural && <span className="text-xs font-medium">{item.natural}</span>}
      {item.physical && (
        <span className="rounded border px-1 text-[10px] text-muted-foreground">physical</span>
      )}
      {item.offered.map((o) => (
        <span key={o.key} className="text-[10px] text-muted-foreground">
          {popupOfferText(o)}
        </span>
      ))}
    </span>
  );
}

const ROLLING_TEXT = "Rolling…";

/** FR-DICEX-40 / -47: actor, label, the row's own total at its right ("Rolling…" till landed). */
function Row({ row }: { row: PopupRow }) {
  const landed = useLanded(row.entryId);
  return (
    <button
      type="button"
      data-testid="dicex-popup-row"
      data-record-id={row.entryId}
      data-landed={landed}
      className="flex w-full shrink-0 items-center gap-1.5 text-left text-sm"
      style={{ height: ROW_H }}
      onClick={() => focusLogEntry(row.entryId)}
    >
      {row.hidden && <EyeOffIcon aria-label="Hidden from players" className="size-3.5 shrink-0" />}
      <RollerName entryId={row.entryId} name={row.actor} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {row.items.map(popupItemLabel).join(" · ")}
      </span>
      {landed ? (
        row.items.map((i) => <Total key={i.key} item={i} />)
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">{ROLLING_TEXT}</span>
      )}
    </button>
  );
}

function Gear() {
  const [pane, setPane] = useState<SettingsPane>("settings");
  return (
    <Popover onOpenChange={(o) => !o && setPane("settings")}>
      <PopoverTrigger asChild>
        <Button
          data-testid="dicex-popup-settings"
          size="icon"
          variant="ghost"
          className="size-5 shrink-0"
          aria-label="Dice settings"
        >
          <SettingsIcon className="size-3.5" />
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

/** The card's padding, its 1 px border included: 10 px top and bottom (table B), 12 px sides. */
const CARD_PAD = { paddingBlock: POPUP_PAD - 1, paddingInline: POPUP_PAD + 1 };

/** A popup's rows, dice line and height (FR-DICEX-46, -47). */
function layoutOf(p: RollPopup) {
  const rows = popupRows(p.entries);
  const line = popupLine(p.t.dice, p.t.more);
  return { rows, line, h: popupHeight(rows.length, line.lines) };
}

function Card({ p, display }: { p: RollPopup; display: DisplaySetting }) {
  const card = useRef<HTMLElement>(null);
  const { rows, line } = useMemo(() => layoutOf(p), [p]);
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
      aria-label="Roll"
      className={cn(
        "pointer-events-auto flex shrink-0 flex-col gap-2 overflow-hidden rounded-lg border text-popover-foreground shadow-lg transition-opacity duration-150",
        p.hidden ? "bg-muted" : "bg-popover",
        p.state === "closing" ? "opacity-0" : "opacity-100",
      )}
      style={{ width: ROLL_POPUP_W, maxHeight: ROLL_POPUP_H, ...CARD_PAD }}
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
          style={{ maxHeight: ROWS_SHOWN * ROW_H }}
        >
          {rows.map((r) => (
            <Row key={r.entryId} row={r} />
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-0.5" style={{ height: ROW_H }}>
          <Gear />
          <Button
            data-testid="dicex-popup-close"
            size="icon"
            variant="ghost"
            className="size-5 shrink-0"
            aria-label="Close"
            onClick={() => rollPopups.close(p.id)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </span>
      </header>
      {line.lines > 0 && <Pip p={p} line={line} card={card} display={display} />}
    </section>
  );
}

/** FR-DICEX-09: the pending card's height (one row). */
const PENDING_H = popupHeight(1, 0);

/** FR-DICEX-09: the own roll in flight, until its entry arrives (or 3 s). */
function PendingCard() {
  return (
    <section
      data-testid="dicex-popup"
      data-state="rolling"
      data-pending="true"
      aria-label="Rolling"
      className="pointer-events-auto flex shrink-0 items-center rounded-lg border bg-popover text-sm text-muted-foreground shadow-lg"
      style={{ width: ROLL_POPUP_W, height: PENDING_H, ...CARD_PAD }}
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
  const initiative = useInitiativeRect(dm);
  const dialogs = useNonModalRects(dm, popups.length > 0 || pending);
  // FR-DICEX-55: the DM stack never covers a tool bar (play-shell's hard keep-outs).
  const keepOuts = useKeepOuts(client);
  // FR-DICEX-55: nor the DM's other shown stacks (the notification toasts, FR-SHELL-59).
  const reports = useSyncExternalStore(subscribeShownStack, shownStacks, shownStacks);
  const stack = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, h: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the cards change
  useEffect(() => {
    const el = stack.current;
    const top = Math.round(el?.parentElement?.getBoundingClientRect().top ?? 0);
    const h = Math.round(el?.getBoundingClientRect().height ?? 0);
    setBox((b) => (b.top === top && b.h === h ? b : { top, h }));
  }, [popups, pending, vp]);
  const clear = dmPopupClear(
    initiative,
    dialogs,
    dm ? hardRects(keepOuts) : [],
    dm ? reports : new Map(),
    SHOWN_ID,
  );
  const at = dmStackAt(vp, box.top, { w: ROLL_POPUP_W, h: box.h }, clear);
  // FR-DICEX-47 short screens: only the popups that fit the region (newest first; the oldest
  // drops), never past the viewport's bottom (DM) or over the top bar (players).
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const room = dm ? vp.h - EDGE_GAP - r.top : r.bottom - TOP_BAR_H - EDGE_GAP;
    const open = popups.filter((p) => p.state !== "closing");
    const heights = open.map((p) => layoutOf(p).h).reverse();
    if (pending) heights.unshift(PENDING_H);
    const keep = Math.max(1, popupsThatFit(heights, room) - (pending ? 1 : 0));
    if (open.length > keep) rollPopups.drop(open.slice(0, open.length - keep).map((p) => p.id));
  });
  // FR-SHELL-59: the DM stack's rendered rect for the Fit (FR-MAP-80); null when empty or gone.
  useLayoutEffect(() => reportShownStack(SHOWN_ID, shownPopupStack(dm, rectOf(stack.current))));
  useEffect(() => () => reportShownStack(SHOWN_ID, null), []);
  if (popups.length === 0 && !pending) return null;
  // Newest nearest the region's anchor: the DM's top, the players' bottom.
  const cards = popups.map((p) => <Card key={p.id} p={p} display={display} />);
  if (pending) cards.push(<PendingCard key="pending" />);
  if (!dm) {
    return (
      <div ref={stack} className="flex flex-col gap-2">
        {cards}
      </div>
    );
  }
  return (
    <div
      ref={stack}
      className="absolute flex flex-col gap-2"
      style={{ left: at.left, top: at.top - box.top }}
    >
      {cards.reverse()}
    </div>
  );
}
