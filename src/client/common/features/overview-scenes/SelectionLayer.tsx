// What the DM's selection draws over the items (FR-OVW-16, -23): an outline per selected item (dashed
// if locked), corner handles on a lone resizable one, the box in progress. Screen-sized, so it reads
// the camera; never takes a hit, the Select tool works out handles itself. `name` = test ID.
import { Group, Rect } from "react-konva";
import { useStore } from "zustand";
import { handlePoint, ITEM_HANDLES, sideBox } from "./item-edit";
import { itemBox, type OverviewItemView } from "./item-layout";
import { ITEM_KIND_DEFS } from "./items/kinds";
import { measureText } from "./label-fonts";
import { useOverviewCanvas } from "./overview-canvas-context";
import { itemPreviews } from "./overview-drag";
import { drawnGesture, previewOf, useOverviewEditor } from "./overview-editor";

const HANDLE_PX = 10;

export function SelectionLayer() {
  const { colors } = useOverviewCanvas();
  const ids = useOverviewEditor((s) => s.selection.tokenIds);
  const items = useOverviewEditor((s) => s.items);
  const scale = useOverviewEditor((s) => s.view.scale);
  const gesture = useOverviewEditor((s) => s.gesture);
  useOverviewEditor((s) => s.fontRev);
  const remote = useStore(itemPreviews, (s) => s.previews);
  const drawn = drawnGesture({ gesture });
  const px = 1 / scale;
  const selected = ids.flatMap((id): OverviewItemView[] => {
    const item = items.find((i) => i.id === id);
    if (!item) return [];
    const r = remote[id];
    return [{ ...item, ...(r ? { x: r.x, y: r.y } : {}), ...previewOf(drawn, item) }];
  });
  const sole = selected.length === 1 ? selected[0] : undefined;
  const handles = sole && !sole.locked && ITEM_KIND_DEFS[sole.kind].resize ? sole : undefined;
  const box = gesture?.kind === "box" ? gesture : null;
  return (
    <Group listening={false} name="ovw-selection">
      {selected.map((item) => {
        const b = itemBox(item, measureText);
        return (
          <Rect
            key={item.id}
            name="ovw-item-selected"
            id={item.id}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            stroke={colors.ring}
            strokeWidth={2 * px}
            dash={item.locked ? [6 * px, 4 * px] : undefined}
          />
        );
      })}
      {handles &&
        ITEM_HANDLES.map((h) => {
          const p = handlePoint(sideBox(handles), h);
          return (
            <Rect
              key={h}
              name={`ovw-handle-${h}`}
              id={handles.id}
              x={p.x - (HANDLE_PX / 2) * px}
              y={p.y - (HANDLE_PX / 2) * px}
              width={HANDLE_PX * px}
              height={HANDLE_PX * px}
              fill={colors.background}
              stroke={colors.ring}
              strokeWidth={1.5 * px}
            />
          );
        })}
      {box && (
        <Rect
          name="ovw-box-select"
          x={Math.min(box.start.x, box.at.x)}
          y={Math.min(box.start.y, box.at.y)}
          width={Math.abs(box.at.x - box.start.x)}
          height={Math.abs(box.at.y - box.start.y)}
          stroke={colors.ring}
          strokeWidth={px}
          dash={[4 * px, 3 * px]}
        />
      )}
    </Group>
  );
}
