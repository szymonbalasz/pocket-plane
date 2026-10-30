// FR-OVW-20: a hidden item for the DM: an outline and an eye-off mark in `visibility.hidden`, at a
// fixed screen size. The item's body draws at `HIDDEN_OPACITY`. Players never receive one. The mark
// sits above the box's top-right corner: at a far zoom it's larger than a short label, and must not
// cover it.
import { Group, Line, Rect } from "react-konva";
import type { Box } from "../../scenes-map/camera";
import { useOverviewCanvas } from "../overview-canvas-context";

export const HIDDEN_OPACITY = 0.45;

/** The mark's centre; `px` = one screen px in units. Its 16 px disc stays clear of the box. */
export const hiddenMarkAt = (box: Box, px: number) => ({
  x: box.x + box.w - 8 * px,
  y: box.y - 11 * px,
});

export function HiddenMark({ box, scale }: { box: Box; scale: number }) {
  const { colors } = useOverviewCanvas();
  const px = 1 / scale;
  return (
    <Group listening={false} name="ovw-item-hidden">
      <Rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        stroke={colors.hidden}
        strokeWidth={1.5 * px}
        dash={[4 * px, 3 * px]}
      />
      <Group name="ovw-item-hidden-icon" {...hiddenMarkAt(box, px)}>
        <Rect
          x={-8 * px}
          y={-8 * px}
          width={16 * px}
          height={16 * px}
          cornerRadius={8 * px}
          fill={colors.background}
          stroke={colors.hidden}
          strokeWidth={px}
        />
        <Line
          points={[-5 * px, 5 * px, 5 * px, -5 * px]}
          stroke={colors.hidden}
          strokeWidth={1.5 * px}
        />
      </Group>
    </Group>
  );
}
