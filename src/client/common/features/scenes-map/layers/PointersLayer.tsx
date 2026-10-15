// Pointers layer: drag target + movement indicator (FR-MAP-15/22/37), ruler (FR-MAP-22), DM box
// select (FR-MAP-32), ping pulses (FR-MAP-23) and laser trails (FR-MAP-24). Reads the canvas'
// pointer store, so 20 laser frames/s re-render only this layer. Ruler and movement distances
// follow the campaign's diagonal rule (FR-SCN-30). Konva names: `map-move-label` (attr `tone`),
// `map-ruler-label`, `map-select-box`, `map-ping`, `map-laser`.
import { distanceFt } from "@shared/scene-tools/geometry";
import { cellToPx } from "@shared/scenes-map/geometry";
import { useEffect, useState } from "react";
import { Circle, Group, Label, Layer, Line, Rect, Tag, Text } from "react-konva";
import { useStore } from "zustand";
import { diagonalRuleIn, rulerText } from "../../scene-tools/diagonal-rule";
import { useCanvas } from "../canvas-context";
import { movedFtOf } from "../decorations";
import { LASER_FADE_MS } from "../laser";
import { type MoveTone, movementIndicator } from "../movement";
import { PING_MS, prune } from "../pointers";
import { tokenOverlays } from "../token-overlays";

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

function DistanceLabel({
  x,
  y,
  text,
  name,
  tone,
}: {
  x: number;
  y: number;
  text: string;
  name: string;
  tone?: MoveTone;
}) {
  const { cam, colors } = useCanvas();
  // OQ-MAP-27: dash = `hp.bloodied`, over = `hp.down`; else foreground.
  const fill =
    tone === "dash" ? colors.hpBloodied : tone === "over" ? colors.hpDown : colors.foreground;
  return (
    <Label x={x} y={y} name={name} tone={tone} listening={false}>
      <Tag fill={colors.background} opacity={0.85} cornerRadius={4 / cam.scale} />
      <Text
        text={text}
        fontSize={13 / cam.scale}
        padding={4 / cam.scale}
        fill={fill}
        fontStyle={tone === "dash" || tone === "over" ? "bold" : "normal"}
        name={`${name}-text`}
      />
    </Label>
  );
}

/** FR-MAP-37: speed from the token record at render; `used` from the overlay registry. */
function MoveLabel({
  drag,
  x,
  y,
}: {
  drag: { tokenId: string; from: { col: number; row: number }; to: { col: number; row: number } };
  x: number;
  y: number;
}) {
  const { tokens, store } = useCanvas();
  const t = tokens.find((k) => k.id === drag.tokenId);
  const used = t ? movedFtOf(tokenOverlays, t, store) : null;
  const m = movementIndicator(
    distanceFt(drag.from, drag.to, diagonalRuleIn(store.records)),
    used,
    t?.speed,
  );
  return <DistanceLabel name="map-move-label" x={x} y={y} text={m.text} tone={m.tone} />;
}

export function PointersLayer() {
  const { grid, cam, colors, pointers, store } = useCanvas();
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
          <MoveLabel drag={st.drag} {...centre(st.drag.to, st.drag.size)} />
        </Group>
      )}
      {st.box && (
        <Rect
          name="map-select-box"
          x={Math.min(st.box.x0, st.box.x1)}
          y={Math.min(st.box.y0, st.box.y1)}
          width={Math.abs(st.box.x1 - st.box.x0)}
          height={Math.abs(st.box.y1 - st.box.y0)}
          stroke={colors.primary}
          strokeWidth={1.5 / cam.scale}
          dash={[6 / cam.scale, 4 / cam.scale]}
          fill={colors.primary}
          opacity={0.6}
          fillEnabled={false}
        />
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
            text={rulerText(st.ruler.from, st.ruler.to, diagonalRuleIn(store.records))}
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
