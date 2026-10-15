// Structure tool pointer handlers (FR-SCN-08), dispatched by MapCanvas (FR-SCN-06). Wall: click
// vertices (snapped), double-click ends → one `scn.addWalls`; Door: two clicks → `scn.addDoor`
// (closed); Erase: click within 8 screen px of a segment, or Ctrl / Shift-drag a box (segments
// fully inside) → `scn.removeSegments`. Esc, a tool / scene switch or leaving live drops the
// gesture (FR-SCN-34). Nothing happens until the shown scene's rows are loaded (ADR-0041).
import type { ToolPointer, ToolPointerHandlers } from "../scenes-map/tools";
import { addDoorEdit, addWallsEdit, removeEdit } from "./structure-edits";
import { resetStructureGesture, shownStructure, structureTool } from "./structure-store";
import { addPoint, hitSegment, polylineSegments, segmentsInBox } from "./structure-view";

/** FR-SCN-08: erase hit tolerance, screen px. */
export const ERASE_TOLERANCE_PX = 8;

function shown(e: ToolPointer) {
  const s = shownStructure.getState();
  return s.loaded && s.sceneId === e.scene.id ? s : null;
}

/** Edits report a reject here (the tool shows it with `toastReject`). */
export function structurePointer(onReject: (err: unknown) => void): ToolPointerHandlers {
  const set = structureTool.setState;
  return {
    down(e) {
      const s = shown(e);
      if (!s) return;
      const st = structureTool.getState();
      if (st.mode === "wall") {
        const points = addPoint(st.points, e.vertex);
        if (e.clicks < 2) {
          set({ points });
          return;
        }
        set({ points: [] });
        const segments = polylineSegments(points);
        if (segments.length > 0) {
          addWallsEdit(e.intent, e.scene.id, s.view, segments).catch(onReject);
        }
        return;
      }
      if (st.mode === "door") {
        const [a] = st.points;
        if (!a) {
          set({ points: [e.vertex] });
          return;
        }
        if (a.x === e.vertex.x && a.y === e.vertex.y) return;
        set({ points: [] });
        addDoorEdit(e.intent, e.scene.id, [a.x, a.y, e.vertex.x, e.vertex.y]).catch(onReject);
        return;
      }
      if (e.ctrl || e.shift) {
        set({ box: { x0: e.x, y0: e.y, x1: e.x, y1: e.y } });
        return;
      }
      const n = hitSegment(s.view, e.grid, e, ERASE_TOLERANCE_PX / s.scale);
      if (n !== null) removeEdit(e.intent, e.scene.id, s.view, [n]).catch(onReject);
    },
    move(e) {
      const st = structureTool.getState();
      const s = shown(e);
      const hoverN =
        st.mode === "erase" && s && !st.box
          ? hitSegment(s.view, e.grid, e, ERASE_TOLERANCE_PX / s.scale)
          : null;
      const box = st.box ? { ...st.box, x1: e.x, y1: e.y } : null;
      const v = st.hover;
      if (v?.x === e.vertex.x && v?.y === e.vertex.y && hoverN === st.hoverN && !box) return;
      set({ hover: e.vertex, hoverN, box });
    },
    up(e) {
      const st = structureTool.getState();
      if (!st.box) return;
      const box = { ...st.box, x1: e.x, y1: e.y };
      set({ box: null });
      const s = shown(e);
      if (!s) return;
      const ns = segmentsInBox(s.view, e.grid, box);
      if (ns.length > 0) removeEdit(e.intent, e.scene.id, s.view, ns).catch(onReject);
    },
    cancel: () => resetStructureGesture(),
  };
}
