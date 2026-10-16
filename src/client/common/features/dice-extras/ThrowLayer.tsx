// Dice-extras runtime, the `dicex.tray` companion (mounted while the kind is available, open or
// not): opens the tray on a stage, drops the request when the tray closes, turns live `roll`
// entries into throws (FR-DICEX-11, -12, -19) and draws them in the throw zone (FR-DICEX-17):
// over the free area, bottom centre, never over a window, nothing interactive. Flat dice in this
// slice (FR-DICEX-21 `flat`): faces fade in at their values, no motion, no render loop.

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { type DiceLook, defaultLook } from "@shared/dice-extras/looks";
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import { recordsOf } from "@shared/protocol/store";
import { EyeOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { FlatDie } from "./FlatDie";
import { useDiceSettings } from "./settings";
import { diceExtras, useDiceExtras } from "./store";
import { isOwn, useRollFrames } from "./throw-source";
import { throwZone } from "./tray-logic";
import { DICEX_TRAY_KIND } from "./window-kind";

/** FR-DICEX-21 `flat`: faces fade in within this. */
export const FLAT_FADE_MS = 300;
/** FR-DICEX-17: the throw fades this long after rest. */
export const REST_MS = 1500;

/** Each entry's roller look (FR-DICEX-20): default looks in D1 (records arrive with D2). */
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

function ThrowView({
  t,
  seq,
  looks,
  isDm,
}: {
  t: DiceThrow;
  seq: number;
  looks: Record<string, DiceLook>;
  isDm: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("moving");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = globalThis.requestAnimationFrame?.(() => setShown(true));
    const rest = setTimeout(() => setPhase("rest"), FLAT_FADE_MS);
    const fade = setTimeout(() => setPhase("fading"), FLAT_FADE_MS + REST_MS);
    const done = setTimeout(() => diceExtras.done(seq), FLAT_FADE_MS + REST_MS + FLAT_FADE_MS);
    return () => {
      if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
      clearTimeout(rest);
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [seq]);
  const header = t.count > 1 ? `${t.roller.name} · ${t.count} rolls` : t.roller.name;
  return (
    <div
      data-testid="dicex-throw"
      data-record-id={t.id}
      data-count={t.count}
      data-render="flat"
      data-state={phase === "fading" ? "rest" : phase}
      className={cn(
        "flex max-w-full flex-col items-center gap-1.5 rounded-lg bg-background/70 px-3 py-2 shadow-lg backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none",
        shown && phase !== "fading" ? "opacity-100" : "opacity-0",
      )}
    >
      <p className="flex items-center gap-1.5 text-sm">
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
      <div className="flex flex-wrap items-end justify-center gap-1.5">
        {t.dice.map((d) => (
          <FlatDie key={d.key} die={d} look={looks[d.entryId]} settled={phase !== "moving"} flat />
        ))}
        {t.more > 0 && (
          <span
            data-testid="dicex-throw-more"
            className="flex h-10 items-center rounded-full border px-2 text-xs text-muted-foreground"
          >
            +{t.more} more
          </span>
        )}
      </div>
      {phase !== "moving" && t.totals.length > 0 && (
        <span data-testid="dicex-throw-total" className="text-lg font-bold tabular-nums">
          {t.totals.join(" · ")}
        </span>
      )}
    </div>
  );
}

export function DiceExtrasRuntime() {
  useTrayWindowSync();
  const { settings, render } = useDiceSettings();
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const current = useDiceExtras((s) => s.current);
  const pending = useDiceExtras((s) => s.pending);
  const zone = useZone();
  const [looks, setLooks] = useState<Record<string, DiceLook>>({});
  const cfg = useRef({ settings, render });
  cfg.current = { settings, render };

  useRollFrames((entries, store) => {
    const own = entries.filter((e) => isOwn(e, store.you));
    if (own.length > 0) diceExtras.ownRolled(own); // FR-DICEX-09 / -10
    if (cfg.current.render === "off") return;
    // FR-DICEX-19: "Show others' rolls" off → own throws only.
    const t = throwDice(cfg.current.settings.others ? entries : own);
    if (!t) return;
    const playerIds = recordsOf<PlayerRecord>(store, "player").map((p) => p.id);
    setLooks(looksOf(t, entries, playerIds));
    diceExtras.play(t);
  });

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
        <ThrowView key={current.seq} t={current.t} seq={current.seq} looks={looks} isDm={isDm} />
      ) : (
        <div
          data-testid="dicex-throw"
          data-render="flat"
          data-state="pending"
          className="rounded-lg bg-background/70 px-3 py-2 text-sm text-muted-foreground shadow-lg"
        >
          Rolling…
        </div>
      )}
    </div>
  );
}
