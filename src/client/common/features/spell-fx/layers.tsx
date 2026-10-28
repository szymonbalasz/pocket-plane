// Spell FX canvas layer entries (FR-VFX-11–17, -22–24, -26–29; OQ-VFX-04 A): `vfx-under` (38,
// below tokens: aura washes, rings, pools, affected cells) and `vfx-over` (43, above tokens, below
// labels: spirits, flames, Moil's cover, reactions, hit looks), both on the `objects` Konva layer.
// Each pass is one non-listening Shape drawing every aura from the page's FX engine; empty Groups
// carry the test IDs (VFX §7.3): `vfx-aura` (id = effect id; attrs `preset`, `tokenId`,
// `radiusFt`, `level`), `vfx-hit` (id = cue id; attrs `look`, `tokenId`), `vfx-cells` (id =
// effect id; attrs `tokenId`, `count`); the `vfx-over` Group carries `frameMs` (median FX frame,
// FR-VFX-27) and `lastHit` (`<cueId>:<look>`). The under entry syncs the engine (auras, level,
// positions); the over entry owns the frame loop and the cues, so the DM's Layers switch
// **Effects** (on `vfx-over`, FR-VFX-28) drops both passes and the cues on that screen.
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { cellToPx, footprint, type MapRect } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { emanationCells } from "@shared/spell-fx/cells";
import type Konva from "konva";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Group, Shape } from "react-konva";
import { useSync } from "../../sync/store";
import { startedIn } from "../combat-tracker/store";
import { withoutDmOnly } from "../scene-tools/layer-switches";
import { useCanvas } from "../scenes-map/canvas-context";
import type { LayerContextMenu, LayerToggle } from "../scenes-map/layers";
import { markColor, selfOf } from "../scenes-map/mark-colors";
import { useLayerToggles } from "../scenes-map/tool-store";
import { aurasOf } from "./anchors";
import { openCellsMenu, useCellsMenuIsland } from "./CellsMenu";
import { pruneCells, useFxCells } from "./cells-store";
import { useHitCues } from "./cues";
import { type DrawnBox, type FxEngine, type FxView, fxEngine } from "./engine";
import { createFxLoop } from "./loop";
import { useVfxLevel, vfxPrefs } from "./prefs";
import { turnStrikes } from "./reactions";

/** FR-VFX-28: the DM Layers popover switch **Effects** (on by default). */
export const VFX_LAYER_SWITCH: LayerToggle = { key: "vfx", label: "Effects", layer: "objects" };

const nativeOf = (kctx: Konva.Context) => kctx._context as unknown as CanvasRenderingContext2D;

/** The canvas' tokens as drawn now (own drag, others' previews, shown cells), for the engine. */
function useFxView(): { view: FxView; drawn: readonly TokenView[] } {
  const c = useCanvas();
  const off = useLayerToggles((s) => s.off);
  const drawn = useMemo(() => withoutDmOnly(c.tokens, c.client, off), [c.tokens, c.client, off]);
  const view = useMemo<FxView>(() => {
    const byId = new Map(drawn.map((t) => [t.id, t]));
    const grid = c.grid;
    const previews = c.previews;
    return {
      cell: grid.gridCellSize,
      position(id): DrawnBox | null {
        const t = byId.get(id);
        if (!t) return null;
        const s = previews.getState();
        const p =
          (s.local?.tokenId === id ? s.local : s.previews[id]) ?? cellToPx(grid, t.col, t.row);
        return { x: p.x, y: p.y, size: footprint(t.size) * grid.gridCellSize };
      },
    };
  }, [drawn, c.grid, c.previews]);
  return { view, drawn };
}

function useSnapshot(engine: FxEngine) {
  return useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
}

/** FR-VFX-28: the DM's Effects switch is off on this screen. */
const useSwitchedOff = (client: "dm" | "player") =>
  useLayerToggles((s) => client === "dm" && s.off[VFX_LAYER_SWITCH.key] === true);

/** Below tokens: aura washes, rings, pools and the affected cells (FR-VFX-24). */
export function VfxUnderLayer() {
  const c = useCanvas();
  const engine = fxEngine();
  const { view, drawn } = useFxView();
  const { level } = useVfxLevel();
  const switchedOff = useSwitchedOff(c.client);
  const store = c.store;
  const specs = useMemo(
    () => aurasOf(store, drawn, { client: c.client, myPlayerId: c.myPlayerId }),
    [store, drawn, c.client, c.myPlayerId],
  );
  engine.setView(view);
  useEffect(() => {
    engine.setLevel(switchedOff ? "off" : level);
  }, [engine, level, switchedOff]);
  useEffect(() => {
    engine.sync(specs);
    pruneCells(c.scene.id, new Set(specs.map((s) => s.key)));
  }, [engine, specs, c.scene.id]);
  useCellsMenuIsland(c.client === "player");
  const snap = useSnapshot(engine);
  const shown = useFxCells((s) => s.shown);
  if (snap.level === "off") return null;
  const rect: MapRect = { ...c.grid, mapWidth: c.scene.mapWidth, mapHeight: c.scene.mapHeight };
  const colour = markColor(store, selfOf(c.client, c.myPlayerId));
  const cells = specs.filter((s) => shown[s.key] && s.radiusFt !== null);
  return (
    <Group name="vfx-under-pass" listening={false}>
      {cells.map((s) => {
        const t = drawn.find((x) => x.id === s.tokenId);
        const count = t
          ? emanationCells(
              { col: t.col, row: t.row, side: footprint(t.size) },
              s.radiusFt ?? 0,
              rect,
            ).length
          : 0;
        return (
          <Group key={s.key} name="vfx-cells" id={s.effectId} tokenId={s.tokenId} count={count}>
            <Shape
              listening={false}
              fill={colour}
              opacity={0.22}
              perfectDrawEnabled={false}
              sceneFunc={(kctx, shape) => {
                // FR-VFX-24: follows the token while dragged (its drawn cell).
                const b = view.position(s.tokenId);
                if (!b) return;
                const cs = c.grid.gridCellSize;
                const col = Math.round((b.x - c.grid.gridOffsetX) / cs);
                const row = Math.round((b.y - c.grid.gridOffsetY) / cs);
                const side = Math.round(b.size / cs);
                kctx.beginPath();
                for (const cell of emanationCells({ col, row, side }, s.radiusFt ?? 0, rect)) {
                  kctx.rect(
                    c.grid.gridOffsetX + cell.col * cs,
                    c.grid.gridOffsetY + cell.row * cs,
                    cs,
                    cs,
                  );
                }
                kctx.fillShape(shape);
              }}
            />
          </Group>
        );
      })}
      <Shape
        name="vfx-under-shape"
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(kctx) => engine.drawUnder(nativeOf(kctx))}
      />
    </Group>
  );
}

/** Above tokens, below labels: spirits, flames, Moil's cover, reactions and hit looks. */
export function VfxOverLayer() {
  const c = useCanvas();
  const engine = fxEngine();
  const snap = useSnapshot(engine);
  const shapeRef = useRef<Konva.Shape>(null);
  const groupRef = useRef<Konva.Group>(null);

  // The frame loop (OQ-VFX-04 A): 30 fps cap, only while something animates on screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const loop = createFxLoop({
      raf: (fn) => window.requestAnimationFrame(fn),
      caf: (h) => window.cancelAnimationFrame(h as number),
      hidden: () => typeof document !== "undefined" && document.hidden,
      step: (ts) => engine.step(ts / 1000),
      draw() {
        const layer = shapeRef.current?.getLayer();
        if (!layer) return 0;
        const t0 = performance.now();
        layer.drawScene();
        return performance.now() - t0;
      },
      animating: () => {
        const stage = shapeRef.current?.getStage();
        if (!stage) return engine.animating();
        const k = stage.scaleX() || 1;
        const vx = -stage.x() / k;
        const vy = -stage.y() / k;
        const vw = stage.width() / k;
        const vh = stage.height() / k;
        return engine.animating(
          (b) => b.x + b.size >= vx && b.y + b.size >= vy && b.x <= vx + vw && b.y <= vy + vh,
        );
      },
      onFrame: (ms) =>
        groupRef.current?.setAttr("frameMs", ms === null ? null : Math.round(ms * 100) / 100),
      onSlow: () => vfxPrefs().lower(),
    });
    const offWake = engine.onWake(() => loop.wake());
    const onVisible = () => loop.wake();
    document.addEventListener("visibilitychange", onVisible);
    loop.wake();
    return () => {
      offWake();
      document.removeEventListener("visibilitychange", onVisible);
      loop.stop();
    };
  }, [engine]);

  // FR-VFX-21 / -22: cues on arrival only; a background tab drops them.
  useHitCues((cue) => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (engine.playCue(cue)) groupRef.current?.setAttr("lastHit", engine.lastHit);
  });

  // FR-VFX-15: the shown turn (FR-MAP-108: DM `turnCombatantId`, players `playerTurnCombatantId`).
  const turnId = useSync((s) => {
    const enc = startedIn(s.store);
    if (!enc || enc.round < 1) return null;
    return (c.client === "dm" ? enc.turnCombatantId : enc.playerTurnCombatantId) ?? null;
  });
  const prevTurn = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevTurn.current;
    prevTurn.current = turnId;
    if (prev === undefined || turnId === null || turnId === prev) return;
    const cb = c.store.records[COMBATANT_TYPE]?.[turnId] as CombatantView | undefined;
    if (!cb) return;
    const token = c.tokens.find((t) => t.id === cb.tokenId);
    const position = (id: string) => engine.position(id);
    for (const s of turnStrikes(
      engine.snapshot().auras,
      cb,
      token,
      position,
      c.grid.gridCellSize,
    )) {
      engine.strike(s.key, s.tokenId);
    }
  }, [turnId, c.store, c.tokens, c.grid.gridCellSize, engine]);

  if (snap.level === "off") return null;
  return (
    <Group ref={groupRef} name="vfx-over-pass" listening={false} level={snap.level}>
      {snap.auras.map((a) => (
        <Group
          key={a.key}
          name="vfx-aura"
          id={a.effectId}
          preset={a.preset.key}
          tokenId={a.tokenId}
          radiusFt={a.radiusFt ?? undefined}
          level={snap.level}
          hidden={a.hidden}
          cover={a.cover}
        />
      ))}
      {snap.looks.map((l) => (
        <Group key={l.key} name="vfx-hit" id={l.cueId} look={l.look} tokenId={l.tokenId} />
      ))}
      <Shape
        ref={shapeRef}
        name="vfx-over-shape"
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(kctx) => engine.drawOver(nativeOf(kctx))}
      />
    </Group>
  );
}

/** FR-VFX-23 (players, FR-MAP-71 step 4): right-click a token that anchors an aura you see. */
export const vfxContextMenu: LayerContextMenu = {
  hit: (p, ctx) => ctx.client === "player" && cellsTargetsAt(p, ctx).length > 0,
  open(p, screen, ctx) {
    const targets = cellsTargetsAt(p, ctx);
    if (targets.length > 0) openCellsMenu({ tokenId: targets[0] as string, at: screen });
  },
};

/** Tokens under map point `p` anchoring an aura with a radius (top-most first). */
function cellsTargetsAt(
  p: { x: number; y: number },
  ctx: { tokens: readonly TokenView[] },
): string[] {
  const engine = fxEngine();
  if (engine.getLevel() === "off") return [];
  const anchored = new Set(
    engine
      .snapshot()
      .auras.filter((a) => a.radiusFt !== null)
      .map((a) => a.tokenId),
  );
  const out: string[] = [];
  for (let i = ctx.tokens.length - 1; i >= 0; i--) {
    const t = ctx.tokens[i];
    if (!t || !anchored.has(t.id)) continue;
    const b = engine.position(t.id);
    if (b && p.x >= b.x && p.x < b.x + b.size && p.y >= b.y && p.y < b.y + b.size) out.push(t.id);
  }
  return out;
}
