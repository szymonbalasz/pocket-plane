// FR-DICEX-33: the dice layer, one fixed full-viewport element portalled to `document.body`
// (no `PlayFrame.tsx` line, seams S7), the **topmost** layer: above windows, chrome, toasts,
// dialogs and the alert flash; `pointer-events: none`, `aria-hidden`, inert, never focusable.
// It holds the page's one WebGL canvas (every arena: screen, zone; D7's PiP) and the screen
// throw's DOM mirror. Dice only, no caption (sim-7: name and total live in the popup). Idle =
// cleared canvas, no loop. Mounted only while the display draws 3D (`screen` / `zone`).
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChunkState } from "./lazy3d";
import type { ThrowRun } from "./store";
import { isMeshDie, Mirror3D, useRun3D, viewportRect } from "./Throw3D";

/** Above sonner's toaster (999,999,999), dialogs (z-50) and the alert flash (z-100). */
export const DICE_LAYER_Z = 2_147_483_647;

/** FR-DICEX-33 `dicex-screen` `data-state`: what the layer's dice are doing. */
export function layerState(
  runs: readonly (ThrowRun | null)[],
): "idle" | "moving" | "rest" | "handoff" {
  const live = runs.filter((r): r is ThrowRun => r !== null && r.plan.draw === "3d");
  if (live.some((r) => r.phase === "moving")) return "moving";
  if (live.some((r) => r.phase === "rest")) return "rest";
  return live.length > 0 ? "handoff" : "idle";
}

function ScreenRun({
  run,
  host,
  interrupted,
  onSlow,
}: {
  run: ThrowRun;
  host: RefObject<HTMLDivElement | null>;
  interrupted: boolean;
  onSlow(): void;
}) {
  const dice = run.t.dice.filter(isMeshDie);
  const rest = useRun3D(run, dice, host, viewportRect, onSlow);
  return (
    <div
      data-testid="dicex-throw"
      data-record-id={run.t.id}
      data-count={run.t.count}
      data-render="3d"
      data-arena="screen"
      data-state={run.phase === "moving" ? "moving" : "rest"}
      data-interrupted={interrupted}
      className="absolute inset-0"
    >
      <Mirror3D dice={dice} looks={run.looks} rest={rest} />
    </div>
  );
}

/** The layer's element (static-renderable); `DiceLayer` portals it to `body`. */
export function DiceLayerView({
  current,
  leaving,
  chunk,
  host,
  onSlow,
}: {
  current: ThrowRun | null;
  leaving: ThrowRun | null;
  chunk: ChunkState;
  /** The canvas host: the renderer puts the page's one canvas (and hand-off stills) here. */
  host: RefObject<HTMLDivElement | null>;
  onSlow(): void;
}) {
  const screen = (r: ThrowRun | null) =>
    r && r.plan.arena === "screen" && r.plan.draw === "3d" ? r : null;
  const runs = [screen(leaving), screen(current)];
  return (
    <div
      data-testid="dicex-screen"
      data-state={layerState([leaving, current])}
      data-chunk={chunk}
      aria-hidden
      inert
      className="pointer-events-none fixed inset-0 overflow-hidden select-none"
      style={{ zIndex: DICE_LAYER_Z }}
    >
      <div ref={host} className="absolute inset-0" />
      {/* Keyed by seq: the interrupted run keeps its instance while it hands off. */}
      {runs.map(
        (r) =>
          r && (
            <ScreenRun
              key={r.seq}
              run={r}
              host={host}
              interrupted={r === runs[0]}
              onSlow={onSlow}
            />
          ),
      )}
    </div>
  );
}

export function DiceLayer(props: Parameters<typeof DiceLayerView>[0]) {
  const body = globalThis.document?.body;
  return body ? createPortal(<DiceLayerView {...props} />, body) : null;
}
