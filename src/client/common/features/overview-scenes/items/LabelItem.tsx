// A place label (FR-OVW-27, -29, -30): the dot at `x, y`, the text right of it, stroked behind the
// fill, all in units so they shrink with the map. `fontRev` re-creates the text when a font lands.
import { useMemo } from "react";
import { Circle, Group, Text } from "react-konva";
import { fontStack, labelLayout, labelStyleOf } from "../item-layout";
import { measureText } from "../label-fonts";
import { HIDDEN_OPACITY, HiddenMark } from "./HiddenMark";
import type { ItemViewProps } from "./item-view";

export function LabelItem({ item, scale, fontRev }: ItemViewProps) {
  const style = labelStyleOf(item);
  const text = item.text ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontRev`: the same text measures anew once its font has loaded.
  const layout = useMemo(
    () => labelLayout(style, measureText(text, style)),
    [style, text, fontRev],
  );
  return (
    <>
      <Group opacity={item.hidden ? HIDDEN_OPACITY : 1}>
        {layout.dotR !== null && (
          <Circle
            name="ovw-label-dot"
            radius={layout.dotR}
            fill={style.dot.color}
            stroke={style.dot.strokeColor}
            strokeWidth={style.dot.strokeWidth}
            strokeEnabled={style.dot.strokeWidth > 0}
            perfectDrawEnabled={false}
          />
        )}
        <Text
          key={fontRev}
          name="ovw-label-text"
          text={text}
          x={layout.textX}
          y={layout.textY}
          wrap="none"
          lineHeight={1}
          fontFamily={fontStack(style.font)}
          fontSize={style.size}
          fill={style.color}
          stroke={style.strokeColor}
          strokeWidth={style.strokeWidth}
          strokeEnabled={style.strokeWidth > 0}
          fillAfterStrokeEnabled
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      </Group>
      {item.hidden && <HiddenMark box={layout.box} scale={scale} />}
    </>
  );
}
