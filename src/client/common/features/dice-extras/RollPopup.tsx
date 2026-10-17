// The roll popup stack (FR-DICEX-39–41; DICEX §7 "Roll popup"), a lazy chunk (≤ 8 KB gz) loaded
// at idle and portalled into the shell's toast region (players bottom-right, newest at the
// bottom; the DM top-centre, newest on top, clear of Initiative). A card per live frame: one
// named row per entry (actor, label, total with its markers), the PiP with the frame's dice (the
// big throw's still, a miniature on the dice layer's one canvas scissored to the card's visible
// rect, or die-shape chips), ✕ and the gear. Click → the Game log at the entry (FR-DICE-37).
// State and timers live in `popups.ts`; nothing here is stored or sent.
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { isMeshDie, type ThrowDie } from "@shared/dice-extras/throw";
import { EyeOffIcon, SettingsIcon, XIcon } from "lucide-react";
import { lazy, type RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { cn } from "../../lib/utils";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import { focusLogEntry } from "../dice-roll-log/focus";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { useViewport } from "../play-shell/hooks";
import type { ShellClient } from "../play-shell/registry";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import { ROLL_POPUP_H, ROLL_POPUP_W } from "../play-shell/toast-region";
import { arenaOf } from "./arena";
import type { Rect } from "./dice3d/index";
import { FlatDie } from "./FlatDie";
import { diceLayerHost, rectOf } from "./layer-host";
import { dice3d, whenChunk } from "./lazy3d";
import {
  dmStackAt,
  type PopupItem,
  type PopupRow,
  pipClip,
  pipDiePx,
  popupRows,
} from "./popup-logic";
import {
  type PartName,
  pipModeOf,
  type RollPopup,
  registerPipSlot,
  rollPopups,
  useRollPopups,
} from "./popups";
import type { SettingsPane } from "./SettingsPanel";
import { type DisplaySetting, is3dDisplay } from "./settings";
import { useDiceExtras } from "./store";

const SettingsPanel = lazy(() =>
  import("./SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
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

/** FR-DICEX-41 a: the big throw's still lands here (the flight reads this slot's rect). */
function HandoffSlot({ p, grow }: { p: RollPopup; grow: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = p.stills.handoff;
  useEffect(() => {
    if (still) paint(canvas.current, still);
  }, [still]);
  return (
    <div
      ref={(el) => registerPipSlot(p.id, "handoff", el)}
      className="relative h-full min-w-12"
      style={{ flex: grow }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}

/**
 * FR-DICEX-41 b: the miniature, on the dice layer's one canvas at this slot's rect (same seed),
 * scissored each frame to the card's visible rect minus dialogs; at rest its pixels are copied
 * into this slot's canvas in the same task. No 3D here or now → chips.
 */
function PlaySlot({
  p,
  dice,
  card,
  display,
  grow,
}: {
  p: RollPopup;
  dice: readonly ThrowDie[];
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
  grow: number;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState<Record<string, number> | null>(null);
  const input = useRef({ p, dice, display });
  input.current = { p, dice, display };
  const key = dice.map((d) => d.key).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per dice set (`key`)
  useEffect(() => {
    const { p: pop, dice: ds, display: shown } = input.current;
    const chips = () => rollPopups.fallback(pop.id, "play", "chips");
    if (!is3dDisplay(shown)) return chips();
    let stop: (() => void) | null = null;
    const cancel = whenChunk(dice3d, (ready) => {
      const mod = dice3d.module();
      const layer = diceLayerHost.current;
      const start = rectOf(slot.current);
      if (!ready || !mod || !layer || !start) return chips();
      const area = () => rectOf(slot.current) ?? start;
      const vp = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight });
      try {
        const h = mod.playThrow({
          layer,
          rect: area,
          clip: () => pipClip(area(), [rectOf(card.current) ?? area(), vp()], coverRects()),
          arena: arenaOf(start, pipDiePx(start, ds.length)),
          shadows: false,
          seed: mod.seedOf(pop.t.seedId),
          dice: ds.map((d) => ({
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
            const at = rectOf(slot.current);
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
    <div ref={slot} className="relative h-full min-w-12" style={{ flex: grow }}>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {dice.map((d) => (
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
    </div>
  );
}

function Pip({
  p,
  card,
  display,
}: {
  p: RollPopup;
  card: RefObject<HTMLElement | null>;
  display: DisplaySetting;
}) {
  const shown = useShown();
  const mode = pipModeOf(p);
  const { handoff, play } = p.parts;
  const { slots, chips } = useMemo(() => {
    const live = (part?: { ids: string[]; chips: boolean }) =>
      part && !part.chips
        ? p.t.dice.filter((d) => part.ids.includes(d.entryId) && isMeshDie(d))
        : [];
    const out: { part: PartName; dice: ThrowDie[] }[] = [];
    const h = live(handoff);
    const m = live(play);
    if (h.length > 0) out.push({ part: "handoff", dice: h });
    if (m.length > 0) out.push({ part: "play", dice: m });
    const in3d = new Set([...h, ...m]);
    return { slots: out, chips: p.t.dice.filter((d) => !in3d.has(d)) };
  }, [p.t, handoff, play]);
  const small = chips.length > 6 || slots.length > 0;
  return (
    <div
      data-testid="dicex-popup-pip"
      data-mode={mode}
      className="flex h-24 min-w-0 flex-1 items-center gap-1"
    >
      {slots.map((s) =>
        s.part === "handoff" ? (
          <HandoffSlot key="h" p={p} grow={s.dice.length} />
        ) : (
          <PlaySlot
            key="m"
            p={p}
            dice={s.dice}
            card={card}
            display={display}
            grow={s.dice.length}
          />
        ),
      )}
      {(chips.length > 0 || p.t.more > 0) && (
        <div
          className={cn(
            "flex max-h-full flex-wrap content-center items-center justify-center gap-1 overflow-hidden transition-opacity duration-300",
            slots.length > 0 ? "shrink-0 basis-1/3" : "flex-1",
            shown ? "opacity-100" : "opacity-0",
          )}
        >
          {chips.map((d) => (
            <FlatDie
              key={d.key}
              die={d}
              look={p.looks[d.entryId]}
              size={small ? "sm" : "md"}
              settled
              flat
            />
          ))}
          {p.t.more > 0 && (
            <span data-testid="dicex-throw-more" className="text-xs text-muted-foreground">
              +{p.t.more} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** One item's total and markers, as the line (FR-DICE-20, -29). */
function Total({ item, big }: { item: PopupItem; big?: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-1 text-right">
      <strong
        data-testid="dicex-popup-total"
        className={cn("tabular-nums", big ? "text-2xl leading-none" : "text-sm")}
      >
        {item.total}
      </strong>
      {item.natural && <span className="text-xs font-medium">{item.natural}</span>}
      {item.physical && (
        <span className="rounded border px-1 text-[10px] text-muted-foreground">physical</span>
      )}
      {item.offered.map((o) => (
        <span key={o.key} className="text-[10px] text-muted-foreground">
          {o.label} {o.value} on a hit
        </span>
      ))}
    </span>
  );
}

const itemLabel = (i: PopupItem) => (i.mode ? `${i.label} (${i.mode})` : i.label);

function Row({ row, rolling, totals }: { row: PopupRow; rolling: boolean; totals: boolean }) {
  return (
    <button
      type="button"
      data-testid="dicex-popup-row"
      data-record-id={row.entryId}
      className="flex w-full items-baseline gap-1.5 text-left text-sm"
      onClick={() => focusLogEntry(row.entryId)}
    >
      {row.hidden && (
        <EyeOffIcon aria-label="Hidden from players" className="size-3.5 shrink-0 self-center" />
      )}
      <strong className="shrink-0 font-semibold">{row.actor}</strong>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {row.items.map(itemLabel).join(" · ")}
      </span>
      {totals && !rolling && row.items.map((i) => <Total key={i.key} item={i} />)}
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
          className="size-6 shrink-0"
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

function Card({ p, display }: { p: RollPopup; display: DisplaySetting }) {
  const card = useRef<HTMLElement>(null);
  const rolling = p.state === "rolling";
  const rows = useMemo(() => popupRows(p.entries), [p.entries]);
  const single = rows.length === 1 ? rows[0] : undefined;
  const hover = (on: boolean) => rollPopups.hover(p.id, on);
  return (
    <section
      ref={card}
      data-testid="dicex-popup"
      data-record-id={p.id}
      data-count={rows.length}
      data-dice={p.t.dice.length}
      data-hidden={p.hidden}
      data-state={p.state}
      aria-label="Roll"
      className={cn(
        "pointer-events-auto flex flex-col gap-1 overflow-hidden rounded-lg border p-2 text-popover-foreground shadow-lg transition-opacity duration-150",
        p.hidden ? "bg-muted" : "bg-popover",
        p.state === "closing" ? "opacity-0" : "opacity-100",
      )}
      style={{ width: ROLL_POPUP_W, maxHeight: ROLL_POPUP_H }}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hover(false);
      }}
    >
      <header className="flex items-start gap-1">
        {/* Rows beyond 2 scroll inside (DICEX §7). */}
        <div className="flex max-h-10 min-w-0 flex-1 flex-col overflow-y-auto">
          {rows.map((r) => (
            <Row key={r.entryId} row={r} rolling={rolling} totals={!single} />
          ))}
        </div>
        <Gear />
        <Button
          data-testid="dicex-popup-close"
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label="Close"
          onClick={() => rollPopups.close(p.id)}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      {/* Body click → the Game log at the entry (FR-DICE-37). */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show in the Game log"
        className="flex min-h-0 items-center gap-2 text-left"
        onClick={() => focusLogEntry(p.id)}
      >
        <Pip p={p} card={card} display={display} />
        {rolling ? (
          <span className="shrink-0 text-xs text-muted-foreground">Rolling…</span>
        ) : (
          single && (
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {single.items.map((i) => (
                <Total key={i.key} item={i} big />
              ))}
            </span>
          )
        )}
      </button>
    </section>
  );
}

/** FR-DICEX-09: the own roll in flight, until its entry arrives (or 3 s). */
function PendingCard() {
  return (
    <section
      data-testid="dicex-popup"
      data-state="rolling"
      data-pending="true"
      aria-label="Rolling"
      className="pointer-events-auto rounded-lg border bg-popover p-2 text-sm text-muted-foreground shadow-lg"
      style={{ width: ROLL_POPUP_W }}
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
  const stack = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, h: 0 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the cards change
  useEffect(() => {
    const el = stack.current;
    const top = Math.round(el?.parentElement?.getBoundingClientRect().top ?? 0);
    const h = Math.round(el?.getBoundingClientRect().height ?? 0);
    setBox((b) => (b.top === top && b.h === h ? b : { top, h }));
  }, [popups, pending, vp]);
  if (popups.length === 0 && !pending) return null;
  // Newest nearest the region's anchor: the DM's top, the players' bottom.
  const cards = popups.map((p) => <Card key={p.id} p={p} display={display} />);
  if (pending) cards.push(<PendingCard key="pending" />);
  if (!dm) return <div className="flex flex-col gap-2">{cards}</div>;
  const at = dmStackAt(vp, box.top, { w: ROLL_POPUP_W, h: box.h }, initiative);
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
