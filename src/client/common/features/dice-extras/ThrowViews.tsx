// The throw views (FR-DICEX-09, -17, -18, -33), a lazy chunk loaded at idle after the first
// snapshot (the initial dice-extras budget, FR-DICEX-22): the dice layer (portalled, topmost) for
// `screen` throws, and the free-area zone (FR-DICEX-17: bottom centre, never over a window,
// nothing interactive) for `zone` throws, whose 3D dice draw on the layer's canvas at the zone's
// rect, flat dice and the pending "Rolling…". Run state and timing live in the store.
import { DicesIcon } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { freeArea, renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { useViewport } from "../play-shell/hooks";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import { DiceLayer } from "./DiceLayer";
import type { Rect } from "./dice3d/index";
import { pendingInZone } from "./display";
import { FlatDie } from "./FlatDie";
import { useChunk3d } from "./lazy3d";
import { type DiceSettings, type DisplaySetting, is3dDisplay } from "./settings";
import { type ThrowRun, useDiceExtras } from "./store";
import { isMeshDie, Mirror3D, useRun3D } from "./Throw3D";
import { throwZone } from "./tray-logic";

/** The throw zone rect in viewport px, or null when it would land on a window. */
function useZone() {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  const measured = useContentHeights();
  return useMemo(() => {
    const rects = renderedWindowRects(windows, registry, available, vp, measured);
    return throwZone(freeArea(rects, vp), rects);
  }, [windows, registry, available, vp, measured]);
}

/** FR-DICEX-17: the zone's dice area = the zone minus the caption, total and chip rows. */
const canvasSize = (zone: { w: number; h: number }, caption: boolean, chips: boolean) => ({
  width: Math.max(160, Math.floor(zone.w - 24)),
  height: Math.max(120, Math.floor(zone.h - (caption ? 64 : 16) - (chips ? 48 : 0))),
});

const rectOf = (el: HTMLElement | null): Rect | null => {
  const r = el?.getBoundingClientRect();
  return r ? { x: Math.round(r.left), y: Math.round(r.top), w: r.width, h: r.height } : null;
};

/** The zone's 3D dice: drawn on the dice layer's canvas at this placeholder's rect. */
function Zone3D({
  run,
  host,
  width,
  height,
  onSlow,
}: {
  run: ThrowRun;
  host: RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  onSlow(): void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const dice = useMemo(() => run.t.dice.filter(isMeshDie), [run.t]);
  const rest = useRun3D(run, dice, host, () => rectOf(area.current), onSlow);
  return (
    <div ref={area} className="relative" style={{ width, height }}>
      <Mirror3D dice={dice} looks={run.looks} rest={rest} />
    </div>
  );
}

function ZoneView({
  run,
  zone,
  host,
  interrupted,
  onSlow,
}: {
  run: ThrowRun;
  zone: { w: number; h: number };
  host: RefObject<HTMLDivElement | null>;
  /** FR-DICEX-18: a newer throw started; this one is at rest and leaving. */
  interrupted: boolean;
  onSlow(): void;
}) {
  const { t, plan, phase, looks } = run;
  const three = plan.draw === "3d";
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = globalThis.requestAnimationFrame?.(() => setShown(true));
    return () => {
      if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
    };
  }, []);
  const atRest = phase !== "moving";
  const leaving = phase === "handoff" || phase === "fading";
  const header = t.count > 1 ? `${t.roller.name} · ${t.count} rolls` : t.roller.name;
  const flatDice = three ? t.dice.filter((d) => !isMeshDie(d)) : t.dice;
  const chips = flatDice.length > 0 || t.more > 0;
  const size = canvasSize(zone, plan.caption, chips);
  const pill = three && "rounded-md bg-background/70 px-2 shadow-sm";
  return (
    <div
      data-testid="dicex-throw"
      data-record-id={t.id}
      data-count={t.count}
      data-render={plan.draw}
      data-arena="zone"
      data-state={atRest ? "rest" : "moving"}
      data-interrupted={interrupted}
      className={cn(
        "flex max-w-full flex-col items-center gap-1.5 rounded-lg px-3 py-2 transition-opacity duration-300 motion-reduce:transition-none",
        !three && "bg-background/70 shadow-lg backdrop-blur-sm",
        // Under the new throw, same spot (the zone is bottom centred).
        interrupted && "absolute bottom-0 left-1/2 -translate-x-1/2",
        (shown || three) && !leaving ? "opacity-100" : "opacity-0",
      )}
    >
      {/* FR-DICEX-17: the caption only while popups are off (sim-7: it covered token labels). */}
      {plan.caption && (
        <p className={cn("flex items-center gap-1.5 text-sm", pill)}>
          <strong className="font-semibold">{header}</strong>
          {t.count === 1 && t.label && <span className="text-muted-foreground">{t.label}</span>}
        </p>
      )}
      {three && (
        <Zone3D run={run} host={host} width={size.width} height={size.height} onSlow={onSlow} />
      )}
      {chips && (
        <div className="flex flex-wrap items-end justify-center gap-1.5">
          {flatDice.map((d) => (
            <FlatDie key={d.key} die={d} look={looks[d.entryId]} settled={three || atRest} flat />
          ))}
          {t.more > 0 && (
            <span
              data-testid="dicex-throw-more"
              className="flex h-10 items-center rounded-full border bg-background/70 px-2 text-xs text-muted-foreground"
            >
              +{t.more} more
            </span>
          )}
        </div>
      )}
      {plan.caption && atRest && t.totals.length > 0 && (
        <span
          data-testid="dicex-throw-total"
          className={cn("text-lg font-bold tabular-nums", pill)}
        >
          {t.totals.join(" · ")}
        </span>
      )}
    </div>
  );
}

export function ThrowViews({
  settings,
  display,
  onSlow,
}: {
  settings: DiceSettings;
  /** The effective display (FR-DICEX-32). */
  display: DisplaySetting;
  onSlow(): void;
}) {
  const current = useDiceExtras((s) => s.current);
  const leaving = useDiceExtras((s) => s.leaving);
  const pending = useDiceExtras((s) => s.pending);
  const chunk = useChunk3d();
  const zone = useZone();
  const host = useRef<HTMLDivElement>(null);
  const inZone = (r: ThrowRun | null) => (r?.plan.arena === "zone" ? r : null);
  const zoneRuns = [inZone(leaving), inZone(current)];
  const showPending = pending && !current && pendingInZone(settings, display);
  const zoneShown = display !== "off" && zone && (zoneRuns.some(Boolean) || showPending);
  const view = (r: ThrowRun, interrupted: boolean) =>
    zone && (
      <ZoneView
        key={r.seq}
        run={r}
        zone={zone}
        host={host}
        interrupted={interrupted}
        onSlow={onSlow}
      />
    );
  return (
    <>
      {is3dDisplay(display) && (
        <DiceLayer current={current} leaving={leaving} chunk={chunk} host={host} onSlow={onSlow} />
      )}
      {zoneShown && (
        <div
          data-testid="dicex-throw-zone"
          aria-hidden
          className="pointer-events-none absolute z-[15] flex flex-col items-center justify-end"
          style={{ left: zone.x, top: zone.y, width: zone.w, height: zone.h }}
        >
          {/* One parent and keyed by seq: the interrupted view keeps its instance. */}
          {zoneRuns.map((r, i) => r && view(r, i === 0))}
          {!current && showPending && (
            <div
              data-testid="dicex-throw"
              data-render={display === "zone" ? "3d" : "flat"}
              data-state="pending"
              className="flex items-center gap-1.5 rounded-lg bg-background/70 px-3 py-2 text-sm text-muted-foreground shadow-lg"
            >
              {/* FR-DICEX-09: 3D shakes the dice; flat / reduced motion is a static label. */}
              {display === "zone" && (
                <DicesIcon className="size-4 animate-bounce motion-reduce:animate-none" />
              )}
              Rolling…
            </div>
          )}
        </div>
      )}
    </>
  );
}
