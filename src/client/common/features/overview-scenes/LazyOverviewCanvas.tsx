// Lazy OverviewCanvas, as LazyMapCanvas: Konva loads on the first scene or overview drawn, in its
// own chunk. A stale chunk: the reload panel in the map area (BL-91).
import { Suspense } from "react";
import { Skeleton } from "../../components/ui/primitives";
import { lazyChunk } from "../../lib/lazy-chunk";
import type { OverviewCanvasProps } from "./OverviewCanvas";

const OverviewCanvasImpl = lazyChunk(
  () => import("./OverviewCanvas").then((m) => ({ default: m.OverviewCanvas })),
  "map",
);

/** Keyed by overview: each one is a fresh canvas with its own camera (FR-OVW-12). */
export function LazyOverviewCanvas(props: OverviewCanvasProps) {
  return (
    <Suspense
      fallback={
        <Skeleton data-testid="ovw-canvas-loading" className="absolute inset-0 rounded-none" />
      }
    >
      <OverviewCanvasImpl key={props.overviewId} {...props} />
    </Suspense>
  );
}
