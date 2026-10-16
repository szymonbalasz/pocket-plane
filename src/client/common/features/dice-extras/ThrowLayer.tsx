// Dice-extras runtime, the `dicex.tray` companion (mounted while the kind is available, open or
// not): opens the tray on a stage, drops the request when the tray closes, turns live `roll`
// entries into throws (FR-DICEX-11, -12, -19) and draws them in the throw zone (FR-DICEX-17):
// over the free area, bottom centre, never over a window, nothing interactive. `flat`: faces fade
// in at their values, no motion, no render loop; `3d`: the lazy chunk tumbles the dice onto the
// server's faces (FR-DICEX-15), then they rest and fade like flat dice.

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { type DiceLook, defaultLook } from "@shared/dice-extras/looks";
import type { DiceThrow } from "@shared/dice-extras/throw";
import { recordsOf } from "@shared/protocol/store";
import { DicesIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { freeArea, renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { useViewport } from "../play-shell/hooks";
import {
  useAvailableKinds,
  useOpenWindow,
  useRegistry,
  useShellState,
} from "../play-shell/ShellContext";
import type { RestInfo } from "./dice3d/index";
import { FlatDie } from "./FlatDie";
import { onRollFrame } from "./frame-handler";
import { dice3d, throwDraw } from "./lazy3d";
import { useDiceSettings } from "./settings";
import { diceExtras, useDiceExtras } from "./store";
import { isMeshDie, SLOW_FRAME_MS, Throw3DStage } from "./Throw3D";
import { useRollFrames } from "./throw-source";
import { throwZone } from "./tray-logic";
import { DICEX_TRAY_KIND } from "./window-kind";

/** FR-DICEX-21 `flat`: faces fade in within this. */
export const FLAT_FADE_MS = 300;
/** FR-DICEX-17: the throw fades this long after rest. */
export const REST_MS = 1500;

/**
 * Each entry's roller look (FR-DICEX-20). The seam for D2's stored looks: the roller's
 * `dice-look` row goes first here once that record type exists; until then the derived default.
 */
function looksOf(
  t: DiceThrow,
  entries: readonly { id: string; rollerRole: string; rollerPlayerId: string | null }[],
  playerIds: readonly string[],
): Record<string, DiceLook> {
  const out: Record<string, DiceLook> = {};
  for (const e of entries) {
    if (!t.entryIds.includes(e.id)) continue;
    out[e.id] = defaultLook(e.rollerRole === "dm" ? null : e.rollerPlayerId, playerIds);
  }
  return out;
}

function useTrayWindowSync() {
  const open = useOpenWindow();
  const staged = useDiceExtras((s) => s.staged);
  const seen = useRef(staged);
  useEffect(() => {
    if (staged === seen.current) return;
    seen.current = staged;
    open(DICEX_TRAY_KIND); // FR-DICEX-01: open / restore + front (FR-SHELL-08)
  }, [staged, open]);
  // FR-DICEX-03: closing the window drops the staged request; minimising keeps it.
  const status = useShellState(
    (s) => s.windows.find((w) => w.kind === DICEX_TRAY_KIND)?.state ?? "closed",
  );
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current !== "closed" && status === "closed") diceExtras.clear();
    prev.current = status;
  }, [status]);
}

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

type Phase = "moving" | "rest" | "fading";

/** FR-DICEX-17: the canvas gets the zone minus the header, total and chip rows. */
const canvasSize = (zone: { w: number; h: number }, chips: boolean) => ({
  width: Math.max(160, Math.floor(zone.w - 24)),
  height: Math.max(120, Math.floor(zone.h - 64 - (chips ? 48 : 0))),
});

function ThrowView({
  t,
  seq,
  looks,
  isDm,
  draw,
  zone,
  onSlow,
}: {
  t: DiceThrow;
  seq: number;
  looks: Record<string, DiceLook>;
  isDm: boolean;
  /** Decided when the throw starts: a chunk that arrives mid-throw waits for the next one. */
  draw: "3d" | "flat";
  zone: { w: number; h: number };
  onSlow(): void;
}) {
  const meshes = useMemo(() => t.dice.filter(isMeshDie), [t]);
  // No mesh die (chips, physical dice) → nothing to tumble: flat.
  const [mode, setMode] = useState<"3d" | "flat">(
    draw === "3d" && meshes.length > 0 ? "3d" : "flat",
  );
  const [phase, setPhase] = useState<Phase>("moving");
  const [rest, setRest] = useState<RestInfo | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = globalThis.requestAnimationFrame?.(() => setShown(true));
    return () => {
      if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
    };
  }, []);
  // Flat: faces fade in, then rest. 3D: the renderer reports rest (or loses its context → flat).
  useEffect(() => {
    if (mode === "3d") return;
    const id = setTimeout(() => setPhase((p) => (p === "moving" ? "rest" : p)), FLAT_FADE_MS);
    return () => clearTimeout(id);
  }, [mode]);
  useEffect(() => {
    if (phase !== "rest") return;
    const fade = setTimeout(() => setPhase("fading"), REST_MS);
    const done = setTimeout(() => diceExtras.done(seq), REST_MS + FLAT_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [phase, seq]);

  const header = t.count > 1 ? `${t.roller.name} · ${t.count} rolls` : t.roller.name;
  const flatDice = mode === "3d" ? t.dice.filter((d) => !isMeshDie(d)) : t.dice;
  const chips = flatDice.length > 0 || t.more > 0;
  const size = canvasSize(zone, chips);
  const pill = mode === "3d" && "rounded-md bg-background/70 px-2 shadow-sm";
  return (
    <div
      data-testid="dicex-throw"
      data-record-id={t.id}
      data-count={t.count}
      data-render={mode}
      data-state={phase === "fading" ? "rest" : phase}
      className={cn(
        "flex max-w-full flex-col items-center gap-1.5 rounded-lg px-3 py-2 transition-opacity duration-300 motion-reduce:transition-none",
        mode === "flat" && "bg-background/70 shadow-lg backdrop-blur-sm",
        (shown || mode === "3d") && phase !== "fading" ? "opacity-100" : "opacity-0",
      )}
    >
      <p className={cn("flex items-center gap-1.5 text-sm", pill)}>
        {isDm && t.hidden && (
          <EyeOffIcon
            data-testid="dicex-throw-hidden"
            aria-label="Hidden from players"
            className="size-3.5 text-visibility-hidden"
          />
        )}
        <strong className="font-semibold">{header}</strong>
        {t.count === 1 && t.label && <span className="text-muted-foreground">{t.label}</span>}
      </p>
      {mode === "3d" && (
        <Throw3DStage
          throwId={t.id}
          dice={meshes}
          looks={looks}
          width={size.width}
          height={size.height}
          rest={rest}
          onRest={(info) => {
            setRest(info);
            setPhase("rest");
            if (info.medianFrameMs !== null && info.medianFrameMs > SLOW_FRAME_MS) onSlow();
          }}
          onLost={() => setMode("flat")}
        />
      )}
      {chips && (
        <div className="flex flex-wrap items-end justify-center gap-1.5">
          {flatDice.map((d) => (
            <FlatDie
              key={d.key}
              die={d}
              look={looks[d.entryId]}
              settled={mode === "3d" || phase !== "moving"}
              flat
            />
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
      {phase !== "moving" && t.totals.length > 0 && (
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

export function DiceExtrasRuntime() {
  useTrayWindowSync();
  const { settings, render, set } = useDiceSettings();
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const current = useDiceExtras((s) => s.current);
  const pending = useDiceExtras((s) => s.pending);
  const zone = useZone();
  const [looks, setLooks] = useState<Record<string, DiceLook>>({});
  const cfg = useRef({ settings, render });
  cfg.current = { settings, render };
  const draw = useRef<"3d" | "flat">("flat");

  useRollFrames((entries, store) => {
    onRollFrame(entries, store, cfg.current, {
      ownRolled: (own) => diceExtras.ownRolled(own),
      load3d: () => dice3d.load(),
      play: (t) => {
        const playerIds = recordsOf<PlayerRecord>(store, "player").map((p) => p.id);
        setLooks(looksOf(t, entries, playerIds));
        draw.current = throwDraw(cfg.current.render, dice3d.state());
        diceExtras.play(t);
      },
    });
  });

  // FR-DICEX-23: slow 3D → flat on this device (switched back in the tray settings).
  const onSlow = () => {
    set({ render: "flat" });
    toast("Dice set to flat: 3D was slow on this device");
  };

  if (render === "off" || !zone) return null;
  const showPending = pending && !current;
  if (!current && !showPending) return null;
  return (
    <div
      data-testid="dicex-throw-zone"
      aria-hidden
      className="pointer-events-none absolute z-[15] flex flex-col items-center justify-end"
      style={{ left: zone.x, top: zone.y, width: zone.w, height: zone.h }}
    >
      {current ? (
        <ThrowView
          key={current.seq}
          t={current.t}
          seq={current.seq}
          looks={looks}
          isDm={isDm}
          draw={draw.current}
          zone={zone}
          onSlow={onSlow}
        />
      ) : (
        <div
          data-testid="dicex-throw"
          data-render={render === "3d" ? "3d" : "flat"}
          data-state="pending"
          className="flex items-center gap-1.5 rounded-lg bg-background/70 px-3 py-2 text-sm text-muted-foreground shadow-lg"
        >
          {/* FR-DICEX-09: 3D shakes the dice; flat / reduced motion is a static label. */}
          {render === "3d" && (
            <DicesIcon className="size-4 animate-bounce motion-reduce:animate-none" />
          )}
          Rolling…
        </div>
      )}
    </div>
  );
}
