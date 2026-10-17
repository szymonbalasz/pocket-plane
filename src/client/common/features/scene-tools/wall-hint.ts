// FR-SCN-38 (#202, #207 OQ-SCN-22 / -23): the player's red wall hint while dragging their token.
// Sprint 4 (seams S1): the `map.checkMove` probe moved to scenes-map's drag probe
// (`scenes-map/drag-probe.ts`: debounce 50 ms, ≤ 10 / s, one in flight, newest wins, stale acks
// dropped); this module only subscribes. The ack's wall-guard pieces (one piece of the first
// crossing, ≤ 0.5 cell either side, server-clipped) are shown until the cell changes, the drag
// ends, a snapshot arrives or the client leaves live; a reject shows nothing (the drop's guard
// decides). DOM-free.
import { type Segment, WALL_GUARD } from "@shared/scene-tools/schemas";
import { CheckMoveResult, type SegmentsHint } from "@shared/scenes-map/schemas";
import type { DragProbe } from "../scenes-map/drag-probe";

/** The wall guard's pieces of a `map.checkMove` ack (zod at the boundary; junk → none). */
export function hintPieces(ack: unknown): Segment[] {
  const r = CheckMoveResult.safeParse(ack);
  if (!r.success) return [];
  return r.data.hints
    .filter((h): h is SegmentsHint => h.guard === WALL_GUARD)
    .flatMap((h) => h.segments);
}

/** Follows the canvas probe; `onChange` gets the pieces to draw red (grid units). */
export function subscribeWallHint(probe: DragProbe, onChange: (pieces: Segment[]) => void) {
  let pieces: Segment[] = [];
  const show = (next: Segment[]) => {
    if (next.length === 0 && pieces.length === 0) return;
    pieces = next;
    onChange(next);
  };
  return probe.subscribe({
    cell: () => show([]),
    ack: (_drag, result) => show(hintPieces(result)),
    done: () => show([]),
    reset: () => show([]),
  });
}
