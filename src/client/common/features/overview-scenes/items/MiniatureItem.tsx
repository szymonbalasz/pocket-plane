// A miniature (FR-OVW-34, -36): its image by shape as a battle token (round, square, none), token
// art with no image, its name centred under it in the label text style. A miniature is no token
// (ADR-0075 Decision 5): nothing of a token's state is drawn. A style preview (FR-OVW-36) re-renders
// only the miniatures it touches.
import { initials } from "@shared/scenes-map/geometry";
import { useMemo } from "react";
import { Circle, Group, Image, Rect, Text } from "react-konva";
import { useAssetImage } from "../../assets-pipeline/useAssetImage";
import { containRect, coverCrop, initialsBackdropOf } from "../../scenes-map/shape";
import { TOKEN_INSET } from "../../scenes-map/token-decor";
import { fontStack, MINIATURE_SIDE_DEFAULT, miniatureLayout, nameStyleOf } from "../item-layout";
import { measureText } from "../label-fonts";
import { patchedStyleOf, useStylePreview } from "../label-style";
import { useOverviewCanvas } from "../overview-canvas-context";
import { HIDDEN_OPACITY, HiddenMark } from "./HiddenMark";
import type { ItemViewProps } from "./item-view";

function Body({ item, side }: { item: ItemViewProps["item"]; side: number }) {
  const { colors } = useOverviewCanvas();
  const img = useAssetImage(item.assetId, "display");
  const shape = item.shape ?? "round";
  const image = img.image;
  const r = side / 2;
  if (image) {
    const w = image.naturalWidth || side;
    const h = image.naturalHeight || side;
    if (shape === "none") return <Image image={image} {...containRect(w, h, side)} />;
    const cover = <Image image={image} width={side} height={side} crop={coverCrop(w, h)} />;
    if (shape === "square") return cover;
    return (
      <Group clipFunc={(ctx) => ctx.arc(r, r, r * TOKEN_INSET, 0, Math.PI * 2, false)}>
        {cover}
      </Group>
    );
  }
  const inset = r * (1 - TOKEN_INSET);
  return (
    <>
      {initialsBackdropOf(shape) === "circle" ? (
        <Circle x={r} y={r} radius={r * TOKEN_INSET} fill={colors.muted} />
      ) : (
        <Rect
          x={inset}
          y={inset}
          width={side - 2 * inset}
          height={side - 2 * inset}
          cornerRadius={side * 0.15}
          fill={colors.muted}
        />
      )}
      <Text
        name="ovw-miniature-art"
        text={initials(item.text ?? "")}
        y={r - r * 0.35}
        width={side}
        align="center"
        fontSize={r * 0.7}
        fontStyle="bold"
        fill={colors.foreground}
        listening={false}
      />
    </>
  );
}

export function MiniatureItem({ item, scale, fontRev }: ItemViewProps) {
  const side = item.w ?? MINIATURE_SIDE_DEFAULT;
  const patch = useStylePreview((s) => (s.preview?.ids.includes(item.id) ? s.preview.patch : null));
  const { kind, style: stored } = item;
  const style = useMemo(
    () => nameStyleOf({ style: patch ? patchedStyleOf({ kind, style: stored }, patch) : stored }),
    [kind, stored, patch],
  );
  const name = item.text ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontRev`: the same name measures anew once its font has loaded.
  const layout = useMemo(
    () => miniatureLayout(side, name, style, name === "" ? 0 : measureText(name, style)),
    [side, name, style, fontRev],
  );
  return (
    <>
      <Group opacity={item.hidden ? HIDDEN_OPACITY : 1}>
        <Body item={item} side={side} />
        {name !== "" && (
          <Text
            key={fontRev}
            name="ovw-miniature-name"
            text={name}
            y={layout.nameY}
            width={side}
            align="center"
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
        )}
      </Group>
      {item.hidden && <HiddenMark box={layout.box} scale={scale} />}
    </>
  );
}
