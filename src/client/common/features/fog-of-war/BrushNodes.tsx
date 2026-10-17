// FR-FOG-55 on the DM canvas (inside the `fog` layer, no new Konva layer): the brush stroke being
// painted and the sent ones awaiting their event (`fog-brush-draft`, attrs `mode` = `snapped` |
// `free`, `cells` (flat col, row) or `points` (flat x, y), `r` (cells), `op`, `pending`), and the
// cursor (`fog-brush-cursor`, attrs `mode`, `ft`): a ring of the radius (free) or the cells a
// stamp would paint (snapped). Never sent anywhere: players get the stroke as fog only.
import { useMemo } from "react";
import { Shape } from "react-konva";
import { diagonalRuleIn } from "../scene-tools/diagonal-rule";
import { useCanvas } from "../scenes-map/canvas-context";
import { type BrushDraft, freeRadius, stampCells } from "./brush";
import type { GestureState } from "./gesture";
import { type PaintCtx, shapePath } from "./render";
import { useFogTool } from "./store";

const DRAFT_OPACITY = 0.35;

function StrokeNode({ draft, pending }: { draft: BrushDraft; pending: boolean }) {
  const { grid, colors } = useCanvas();
  const mode = useFogTool((s) => s.mode);
  const r = draft.free ? freeRadius(draft.ft) : draft.ft / 5;
  const attrs = draft.free ? { points: draft.points.flat() } : { cells: draft.cells.flat() };
  return (
    <Shape
      name="fog-brush-draft"
      mode={draft.free ? "free" : "snapped"}
      op={mode}
      pending={pending}
      r={r}
      {...attrs}
      perfectDrawEnabled={false}
      sceneFunc={(kctx) => {
        const ctx = kctx._context as unknown as PaintCtx;
        ctx.save();
        ctx.globalAlpha = DRAFT_OPACITY;
        ctx.beginPath();
        if (draft.free) {
          shapePath(ctx, { stroke: [r, ...draft.points.flat()] }, grid);
        } else {
          const cs = grid.gridCellSize;
          for (const [c, w] of draft.cells) {
            ctx.rect(grid.gridOffsetX + c * cs, grid.gridOffsetY + w * cs, cs, cs);
          }
        }
        ctx.fillStyle = colors.primary;
        ctx.fill("nonzero");
        ctx.restore();
      }}
    />
  );
}

function BrushCursor({ free }: { free: boolean }) {
  const { grid, cam, colors, store } = useCanvas();
  const hover = useFogTool((s) => s.hover);
  const ft = useFogTool((s) => s.brushFt);
  const rule = diagonalRuleIn(store.records);
  const on = hover !== null;
  const col = hover ? Math.floor(hover[0]) : 0;
  const row = hover ? Math.floor(hover[1]) : 0;
  const cells = useMemo(
    () => (free || !on ? [] : stampCells(col, row, ft, rule)),
    [free, on, col, row, ft, rule],
  );
  if (!hover) return null;
  const cs = grid.gridCellSize;
  const X = (x: number) => grid.gridOffsetX + x * cs;
  const Y = (y: number) => grid.gridOffsetY + y * cs;
  return (
    <Shape
      name="fog-brush-cursor"
      mode={free ? "free" : "snapped"}
      ft={ft}
      perfectDrawEnabled={false}
      sceneFunc={(kctx) => {
        const ctx = kctx._context as unknown as PaintCtx;
        ctx.save();
        ctx.beginPath();
        if (free) {
          const R = freeRadius(ft) * cs;
          ctx.moveTo(X(hover[0]) + R, Y(hover[1]));
          ctx.arc(X(hover[0]), Y(hover[1]), R, 0, 2 * Math.PI);
        } else {
          for (const [c, w] of cells) ctx.rect(X(c), Y(w), cs, cs);
        }
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = colors.primary;
        if (!free) ctx.fill("nonzero");
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 1.5 / cam.scale;
        ctx.stroke();
        ctx.restore();
      }}
    />
  );
}

/** The brush's nodes while the Fog tool is active (Shape Brush, or strokes still in flight). */
export function BrushNodes({ gesture }: { gesture: GestureState }) {
  const brush = useFogTool((s) => s.shape === "brush" && s.mode !== "darkness");
  const draft = gesture.draft?.kind === "brush" ? gesture.draft : null;
  return (
    <>
      {gesture.strokes.map((d, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sent strokes keep their order until settled.
        <StrokeNode key={k} draft={d} pending />
      ))}
      {draft && <StrokeNode draft={draft} pending={false} />}
      {brush && <BrushCursor free={draft ? draft.free : gesture.free} />}
    </>
  );
}
