// Lazy MapCanvas: Konva (react-konva + konva, ~500 KB) loads in its own chunk on first render of a
// scene, so the shell, DM login and player join screen load without it. Same props as MapCanvas.
import { Suspense } from "react";
import { Skeleton } from "../../components/ui/primitives";
import { lazyChunk } from "../../lib/lazy-chunk";
import type { MapCanvasProps } from "./MapCanvas";

// A stale chunk: a reload panel in the map area (BL-91).
const MapCanvasImpl = lazyChunk(
  () => import("./MapCanvas").then((m) => ({ default: m.MapCanvas })),
  "map",
);

export function LazyMapCanvas(props: MapCanvasProps) {
  return (
    <Suspense
      fallback={
        <Skeleton data-testid="map-canvas-loading" className="absolute inset-0 rounded-none" />
      }
    >
      <MapCanvasImpl {...props} />
    </Suspense>
  );
}
