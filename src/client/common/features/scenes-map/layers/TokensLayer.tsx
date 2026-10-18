// Tokens layer (FR-MAP-14–19, -31, -34, -35, -43): image or initials per shape, DM hidden styling,
// selection / target ring, overlay cross, bar, icons and dim (inside the token's group, so they
// move with a drag and show in drag previews). Names and badges are on the labels layer
// (FR-MAP-42). No image: the creature-type glyph on its type colour, else initials (FR-ENT-28).
// Konva node `name` = `map-token`, `id` = token id, attrs `shape`, `preview` (FR-MAP-40), `art`
// (`image` | `<type>` | `initials`, FR-ENT-28); glyph `map-token-art` (attr `creature`); ring
// `map-token-ring` (attr `state`); crosses, bars and icons named by their overlay id (bar attrs
// `tone`, `fraction`; icon attrs `value`, `icon`, `tone`, `label`, `muted`, and
// `tip` = the hover tooltip the labels layer shows, FR-MAP-57 / S9); "+N" `map-token-icons-more`
// (attrs `count`, `tip`); a cue (FR-MAP-49) named by its id, attr `label`. Drag
// paths and combat trails (FR-MAP-52–55) are drawn first, below every token (`DragPaths`).
import type { CreatureType } from "@shared/entities/schemas";
import { cellToPx, footprint, initials } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { useEffect, useMemo, useRef } from "react";
import { Circle, Group, Image, Line, Path, Rect, Shape, Text } from "react-konva";
import { useStore } from "zustand";
import { retryAssetImage, useAssetImage } from "../../assets-pipeline/useAssetImage";
import { glyphRect, tokenArtOf } from "../../entities/art";
import { CREATURE_ART } from "../../entities/creature-art";
import { withoutDmOnly } from "../../scene-tools/layer-switches";
import { useCanvas } from "../canvas-context";
import { decorateToken, type MergedDecoration } from "../decorations";
import { CROSS_OPACITY, crossGeometry } from "../label";
import { artBackdropOf, containRect, coverCrop, initialsBackdropOf, outlineOf } from "../shape";
import { barGeometry, cueGeometry, cuePulse, iconRow } from "../token-decor";
import type { TokenBar, TokenCross, TokenCue, TokenIcon } from "../token-overlays";
import { tokenOverlays } from "../token-overlays";
import { useLayerToggles } from "../tool-store";
import { DragPaths } from "./DragPaths";
import { toneColor } from "./tone";

const INSET = 0.92;

/** Backdrop per shape: a disc (round) or a rounded square inset like the outline. */
function Backdrop({
  kind,
  side,
  fill,
}: {
  kind: "circle" | "rounded-square";
  side: number;
  fill: string;
}) {
  const r = side / 2;
  const inset = r * (1 - INSET);
  return kind === "circle" ? (
    <Circle x={r} y={r} radius={r * INSET} fill={fill} />
  ) : (
    <Rect
      x={inset}
      y={inset}
      width={side - 2 * inset}
      height={side - 2 * inset}
      cornerRadius={side * 0.15}
      fill={fill}
    />
  );
}

/** FR-ENT-28: the type's glyph (white, ≈ 65 % of the footprint) on its colour per shape. */
function CreatureArt({ t, side, type }: { t: TokenView; side: number; type: CreatureType }) {
  const { colors } = useCanvas();
  const glyph = CREATURE_ART[type];
  const box = glyphRect(side);
  const vb = glyph.viewBox.split(" ").map(Number);
  const k = box.size / (vb[2] ?? 512);
  const backdrop = artBackdropOf(t.shape);
  return (
    <>
      {backdrop && <Backdrop kind={backdrop} side={side} fill={colors.creature[type]} />}
      <Path
        name="map-token-art"
        creature={type}
        data={glyph.path}
        x={box.x - (vb[0] ?? 0) * k}
        y={box.y - (vb[1] ?? 0) * k}
        scaleX={k}
        scaleY={k}
        fill={colors.creatureGlyph}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  );
}

/** Token art per shape (FR-MAP-35); creature-type art or initials when there is no image (yet). */
function TokenBody({
  t,
  side,
  image,
}: {
  t: TokenView;
  side: number;
  image: HTMLImageElement | null;
}) {
  const { colors } = useCanvas();
  const r = side / 2;
  if (image) {
    const w = image.naturalWidth || side;
    const h = image.naturalHeight || side;
    if (t.shape === "none") return <Image image={image} {...containRect(w, h, side)} />;
    const cover = (
      <Image image={image} x={0} y={0} width={side} height={side} crop={coverCrop(w, h)} />
    );
    if (t.shape === "square") return cover;
    return (
      <Group clipFunc={(ctx) => ctx.arc(r, r, r * INSET, 0, Math.PI * 2, false)}>{cover}</Group>
    );
  }
  const art = tokenArtOf({ imageAssetId: null, creatureType: t.creatureType });
  if (art !== "initials" && art !== "image") return <CreatureArt t={t} side={side} type={art} />;
  return (
    <>
      <Backdrop kind={initialsBackdropOf(t.shape)} side={side} fill={colors.muted} />
      <Text
        text={initials(t.name)}
        x={0}
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

/** Selection / target ring, hidden outline or the plain border; follows the shape (none: square). */
function TokenOutline({
  t,
  side,
  state,
}: {
  t: TokenView;
  side: number;
  state: "selected" | "target" | null;
}) {
  const { colors, cam } = useCanvas();
  const r = side / 2;
  let stroke: string;
  let width = 1.5 / cam.scale;
  let dash: number[] | undefined;
  if (state === "target") {
    stroke = colors.destructive;
    width = 3 / cam.scale;
  } else if (state === "selected") {
    stroke = colors.primary;
    width = 3 / cam.scale;
  } else if (t.hidden) {
    stroke = colors.hidden;
    dash = [6 / cam.scale, 4 / cam.scale];
  } else if (t.shape === "none") {
    return null;
  } else {
    stroke = colors.background;
  }
  const common = {
    name: state ? "map-token-ring" : undefined,
    state: state ?? undefined,
    stroke,
    strokeWidth: width,
    dash,
    listening: false,
  };
  if (outlineOf(t.shape) === "circle") {
    return <Circle x={r} y={r} radius={r * INSET} {...common} />;
  }
  const inset = state && t.shape === "none" ? 0 : r * (1 - INSET) * 0.5;
  return (
    <Rect x={inset} y={inset} width={side - 2 * inset} height={side - 2 * inset} {...common} />
  );
}

/** FR-MAP-43: a translucent X over the footprint, one path so the crossing isn't darker. */
function TokenCrossMark({ t, side, cross }: { t: TokenView; side: number; cross: TokenCross }) {
  const { colors } = useCanvas();
  const g = crossGeometry(side);
  return (
    <Shape
      name={cross.id}
      id={t.id}
      tone={cross.tone}
      width={side}
      height={side}
      stroke={toneColor(colors, cross.tone)}
      strokeWidth={g.strokeWidth}
      lineCap="round"
      opacity={CROSS_OPACITY}
      listening={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of g.segments) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

/** OQ-CBTX-21: bar on the top edge (fill in tone, temp as a neutral segment, muted track). */
function TokenBarMark({ t, side, bar }: { t: TokenView; side: number; bar: TokenBar }) {
  const { colors } = useCanvas();
  const g = barGeometry(side, bar);
  const r = g.height / 2;
  return (
    <Group name={bar.id} id={t.id} tone={bar.tone} fraction={bar.fraction} listening={false}>
      <Rect
        x={g.x}
        y={g.y}
        width={g.width}
        height={g.height}
        cornerRadius={r}
        fill={colors.background}
        opacity={g.track ? 0.75 : 0}
      />
      {g.fill && (
        <Rect
          x={g.fill.x}
          y={g.y}
          width={g.fill.width}
          height={g.height}
          cornerRadius={r}
          fill={toneColor(colors, bar.tone)}
        />
      )}
      {g.temp && (
        <Rect
          x={g.temp.x}
          y={g.y}
          width={g.temp.width}
          height={g.height}
          cornerRadius={r}
          fill={toneColor(colors, "neutral")}
          opacity={0.7}
        />
      )}
    </Group>
  );
}

function IconDisc(p: { x: number; y: number; size: number; text: string; color: string }) {
  const { colors } = useCanvas();
  return (
    <>
      <Circle
        x={p.x + p.size / 2}
        y={p.y + p.size / 2}
        radius={p.size / 2}
        fill={colors.background}
        stroke={p.color}
        strokeWidth={p.size * 0.08}
      />
      <Text
        text={p.text}
        x={p.x}
        y={p.y + p.size * 0.26}
        width={p.size}
        align="center"
        fontSize={p.size * 0.48}
        fontStyle="bold"
        fill={p.color}
      />
    </>
  );
}

/**
 * OQ-CBTX-21: up to 4 icon discs (initials in the tone colour, a muted icon in the muted one)
 * below the bar, then "+N"; each with its label as the hover tooltip (FR-MAP-57, S9).
 */
function TokenIconRow({
  t,
  side,
  icons,
}: {
  t: TokenView;
  side: number;
  icons: readonly TokenIcon[];
}) {
  const { colors } = useCanvas();
  const row = iconRow(side, icons);
  return (
    <>
      {row.items.map((c) => (
        <Group
          key={c.x}
          name={c.icon.id}
          id={t.id}
          value={c.icon.value}
          icon={c.icon.icon}
          tone={c.icon.tone}
          label={c.icon.label}
          muted={c.muted}
          tip={c.tip}
          listening={false}
        >
          <IconDisc
            x={c.x}
            y={c.y}
            size={c.size}
            text={c.text}
            color={c.muted ? colors.mutedForeground : toneColor(colors, c.icon.tone)}
          />
        </Group>
      ))}
      {row.more && (
        <Group
          name="map-token-icons-more"
          id={t.id}
          count={row.more.count}
          tip={row.more.tip}
          listening={false}
        >
          <IconDisc
            x={row.more.x}
            y={row.more.y}
            size={row.more.size}
            text={row.more.text}
            color={toneColor(colors, "neutral")}
          />
        </Group>
      )}
    </>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Bell glyph (dome, flared rim, clapper) in a disc of radius `r` centred on (0, 0). */
function bellPath(ctx: Konva.Context, r: number) {
  const w = r * 0.55;
  ctx.moveTo(-w, r * 0.3);
  ctx.quadraticCurveTo(-w * 0.85, -r * 0.55, 0, -r * 0.55);
  ctx.quadraticCurveTo(w * 0.85, -r * 0.55, w, r * 0.3);
  ctx.lineTo(w * 1.2, r * 0.42);
  ctx.lineTo(-w * 1.2, r * 0.42);
  ctx.closePath();
  ctx.moveTo(r * 0.14, r * 0.55);
  ctx.arc(0, r * 0.55, r * 0.14, 0, Math.PI * 2, false);
}

/** FR-MAP-49: pulsing accent ring + bell, above image, bar and icons; steady if reduced motion. */
function TokenCueMark({ t, side, cue }: { t: TokenView; side: number; cue: TokenCue }) {
  const { colors, client } = useCanvas();
  const ringRef = useRef<Konva.Circle>(null);
  const g = cueGeometry(side);
  const accent = client === "dm" ? colors.dmAccent : colors.playerAccent;
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const ring = ringRef.current;
    if (!ring || reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = cuePulse(now - start, false);
      ring.opacity(p.opacity);
      ring.scale({ x: p.scale, y: p.scale });
      ring.getLayer()?.batchDraw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Group name={cue.id} id={t.id} label={cue.label} listening={false}>
      <Circle
        ref={ringRef}
        x={g.ring.x}
        y={g.ring.y}
        radius={g.ring.radius}
        stroke={accent}
        strokeWidth={g.ring.strokeWidth}
      />
      <Circle
        x={g.bell.x}
        y={g.bell.y}
        radius={g.bell.radius}
        fill={colors.background}
        stroke={accent}
        strokeWidth={g.bell.radius * 0.16}
      />
      <Shape
        x={g.bell.x}
        y={g.bell.y}
        fill={accent}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          bellPath(ctx, g.bell.radius);
          ctx.fillShape(shape);
        }}
      />
    </Group>
  );
}

function TokenNode({ t }: { t: TokenView }) {
  const c = useCanvas();
  const { grid, colors, cam } = c;
  const img = useAssetImage(t.imageAssetId, "thumb");
  useEffect(() => {
    if (t.imageAssetId) retryAssetImage(t.imageAssetId, "thumb");
  }, [t]);
  // FR-MAP-40: another client's drag of T draws it at the previewed spot (only this group re-renders).
  const preview = useStore(c.previews, (s) => s.previews[t.id]);
  const side = footprint(t.size) * grid.gridCellSize;
  const { x, y } = preview ?? cellToPx(grid, t.col, t.row);
  const movable = c.canMove(t);
  const draggable = movable && c.live && c.tool === "select";
  // FR-MAP-28: stable drag handlers. react-konva detaches a changed handler, then sets attrs, then
  // attaches the new one; leaving live sets `draggable: false`, whose `stopDrag()` fires `dragend`
  // in that gap, so a per-render arrow would miss it (the drag never ends, its frames repeat).
  const latest = useRef({ t, token: c.token });
  latest.current = { t, token: c.token };
  const drag = useMemo(
    () => ({
      onDragStart: (e: { target: Konva.Node }) =>
        latest.current.token.dragStart(latest.current.t, e.target),
      onDragMove: (e: { target: Konva.Node }) =>
        latest.current.token.dragMove(latest.current.t, e.target),
      onDragEnd: (e: { target: Konva.Node }) =>
        latest.current.token.dragEnd(latest.current.t, e.target),
    }),
    [],
  );
  const selected = c.selected.has(t.id);
  const deco: MergedDecoration = decorateToken(tokenOverlays, t, c.store, {
    client: c.client,
    selected,
    targeting: c.targeting,
  });
  const ring = deco.ring === "target" ? "target" : selected ? "selected" : null;
  const setCursor =
    (cursor: string) => (e: { target: { getStage(): { container(): HTMLElement } | null } }) => {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = cursor;
    };

  return (
    <Group
      name="map-token"
      id={t.id}
      shape={t.shape}
      art={tokenArtOf(t)}
      preview={preview ? true : undefined}
      x={x}
      y={y}
      draggable={draggable}
      opacity={(t.hidden ? 0.45 : 1) * (deco.dim ? 0.5 : 1)}
      {...drag}
      onClick={(e) => {
        if (e.evt.button === 0) c.token.click(t, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey);
      }}
      onDblClick={() => c.token.dblClick(t)}
      onMouseEnter={setCursor(draggable ? "grab" : "")}
      onMouseLeave={setCursor("")}
    >
      {/* Hit area: the whole footprint, whatever the art's alpha. */}
      <Rect width={side} height={side} fill="transparent" />
      <TokenBody t={t} side={side} image={img.image} />
      {deco.cross && <TokenCrossMark t={t} side={side} cross={deco.cross} />}
      <TokenOutline t={t} side={side} state={ring} />
      {deco.bar && <TokenBarMark t={t} side={side} bar={deco.bar} />}
      {deco.icons.length > 0 && <TokenIconRow t={t} side={side} icons={deco.icons} />}
      {deco.cue && <TokenCueMark t={t} side={side} cue={deco.cue} />}
      {t.hidden && (
        // Eye-off mark in `visibility.hidden` (only the DM ever receives hidden tokens).
        <Group x={side - 9 / cam.scale} y={9 / cam.scale} listening={false} name="map-token-hidden">
          <Circle
            radius={8 / cam.scale}
            fill={colors.background}
            stroke={colors.hidden}
            strokeWidth={1 / cam.scale}
          />
          <Line
            points={[-5 / cam.scale, 5 / cam.scale, 5 / cam.scale, -5 / cam.scale]}
            stroke={colors.hidden}
            strokeWidth={1.5 / cam.scale}
          />
        </Group>
      )}
    </Group>
  );
}

export function TokensLayer() {
  const { tokens, client } = useCanvas();
  // FR-SCN-05: the DM's "DM-only items" switch off → hidden tokens not drawn, not hit.
  const off = useLayerToggles((s) => s.off);
  const drawn = useMemo(() => withoutDmOnly(tokens, client, off), [tokens, client, off]);
  return (
    <Group name="tokens-layer">
      <DragPaths tokens={drawn} />
      {drawn.map((t) => (
        <TokenNode key={t.id} t={t} />
      ))}
    </Group>
  );
}
