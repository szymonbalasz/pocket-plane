// Pointers layer: drag target + distance (FR-MAP-15/22), ruler (FR-MAP-22), ping pulses
// (FR-MAP-23) and laser trails (FR-MAP-24). Reads the canvas' pointer store, so 20 laser
// frames/s re-render only this layer. Konva names: `map-ruler-label`, `map-ping`, `map-laser`.
import { cellToPx, distanceLabel } from "@shared/scenes-map/geometry";
import { useEffect, useState } from "react";
import { Circle, Group, Label, Layer, Line, Rect, Tag, Text } from "react-konva";
import { useStore } from "zustand";
import { useCanvas } from "../canvas-context";
import { LASER_FADE_MS } from "../laser";
import { PING_MS, prune } from "../pointers";

/** Re-renders every animation frame while `active`. */
function useFrameClock(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const tick = () => {
      setNow(performance.now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active]);
  return now;
}

function DistanceLabel({ x, y, text, name }: { x: number; y: number; text: string; name: string }) {
  const { cam, colors } = useCanvas();
  return (
    <Label x={x} y={y} name={name} listening={false}>
      <Tag fill={colors.background} opacity={0.85} cornerRadius={4 / cam.scale} />
      <Text
        text={text}
        fontSize={13 / cam.scale}
        padding={4 / cam.scale}
        fill={colors.foreground}
        name={`${name}-text`}
      />
    </Label>
  );
}

export function PointersLayer() {
  const { grid, cam, colors, pointers } = useCanvas();
  const st = useStore(pointers);
  const animating = st.pings.length > 0 || Object.keys(st.trails).length > 0;
  const now = useFrameClock(animating);
  useEffect(() => {
    if (animating) prune(pointers, now);
  }, [animating, now, pointers]);
  const cell = grid.gridCellSize;
  const centre = (c: { col: number; row: number }, n = 1) => {
    const p = cellToPx(grid, c.col, c.row);
    return { x: p.x + (n * cell) / 2, y: p.y + (n * cell) / 2 };
  };
  const accent = (role: "dm" | "player") => (role === "dm" ? colors.dmAccent : colors.playerAccent);

  return (
    <Layer listening={false} name="pointers-layer">
      {st.drag && (
        <Group name="map-drag-target">
          <Rect
            {...cellToPx(grid, st.drag.to.col, st.drag.to.row)}
            width={st.drag.size * cell}
            height={st.drag.size * cell}
            stroke={colors.primary}
            strokeWidth={2 / cam.scale}
            dash={[6 / cam.scale, 4 / cam.scale]}
          />
          <DistanceLabel
            name="map-drag-label"
            {...centre(st.drag.to, st.drag.size)}
            text={distanceLabel(st.drag.from, st.drag.to)}
          />
        </Group>
      )}
      {st.ruler && (
        <Group name="map-ruler">
          <Line
            points={[
              centre(st.ruler.from).x,
              centre(st.ruler.from).y,
              centre(st.ruler.to).x,
              centre(st.ruler.to).y,
            ]}
            stroke={colors.primary}
            strokeWidth={2 / cam.scale}
            dash={[8 / cam.scale, 4 / cam.scale]}
          />
          <DistanceLabel
            name="map-ruler-label"
            {...centre(st.ruler.to)}
            text={distanceLabel(st.ruler.from, st.ruler.to)}
          />
        </Group>
      )}
      {st.pings.map((p) => {
        const t = Math.min(1, Math.max(0, (now - p.at) / PING_MS));
        return (
          <Circle
            key={p.id}
            name="map-ping"
            x={p.x}
            y={p.y}
            radius={(10 + 50 * t) / cam.scale}
            stroke={accent(p.role)}
            strokeWidth={3 / cam.scale}
            opacity={1 - t}
          />
        );
      })}
      {Object.values(st.trails).map((tr) => {
        const last = tr.points.at(-1);
        const age = last ? now - last.at : LASER_FADE_MS;
        return (
          <Line
            key={tr.key}
            name="map-laser"
            points={tr.points.flatMap((p) => [p.x, p.y])}
            stroke={accent(tr.role)}
            strokeWidth={4 / cam.scale}
            lineCap="round"
            lineJoin="round"
            opacity={Math.max(0, 1 - age / LASER_FADE_MS)}
            shadowColor={accent(tr.role)}
            shadowBlur={8 / cam.scale}
          />
        );
      })}
    </Layer>
  );
}
