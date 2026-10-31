// `scn-template-labels` canvas layer (order 47, FR-SCN-59): the AoE templates' label pills, in the
// `top` Konva layer so that no token, token label or aura covers them. `TemplatesLayer` works out
// each pill with its template (it holds the squares) and publishes it here; this layer draws them.
// Each pill: a colour dot + "‹label› · N squares" (+ " · by ‹name›" while hovered or selected,
// FR-SCN-47 / -52) and below it the template's measures (FR-SCN-60). No pointer events. Konva:
// label `scn-template-label` (id = template id; `hovered` = true while hovered) with
// `scn-template-label-dot`, `scn-template-label-text` and `scn-template-label-measures`.
import Konva from "konva";
import { Circle, Group, Rect, Text } from "react-konva";
import { create } from "zustand";
import { useCanvas } from "../../scenes-map/canvas-context";
import { CASING_COLOR } from "../../scenes-map/mark-colors";

export interface TemplatePill {
  /** The template's origin, in map px. */
  x: number;
  y: number;
  caption: string;
  measures: string;
  color: string;
  hidden: boolean;
  hovered: boolean;
}

/** The drawn templates' pills, in draw order: written by `TemplatesLayer`. */
export const useTemplatePills = create<{ byId: Readonly<Record<string, TemplatePill>> }>(() => ({
  byId: {},
}));

export function setTemplatePill(id: string, pill: TemplatePill): void {
  useTemplatePills.setState((s) => ({ byId: { ...s.byId, [id]: pill } }));
}

export function removeTemplatePill(id: string): void {
  useTemplatePills.setState((s) => {
    const { [id]: _gone, ...rest } = s.byId;
    return { byId: rest };
  });
}

/** Text width in map px for the label pill (Konva measures off-stage). */
let measurer: Konva.Text | null = null;
function textWidth(text: string, fontSize: number, padding: number): number {
  measurer ??= new Konva.Text({});
  measurer.setAttrs({ text, fontSize, padding });
  return measurer.width();
}

function TemplateLabel({ id, pill }: { id: string; pill: TemplatePill }) {
  const { cam, colors } = useCanvas();
  const s = cam.scale;
  const font = 12 / s;
  const pad = 3 / s;
  const dot = 8 / s;
  const lead = pad + dot;
  const line = font + pad;
  const width =
    lead + Math.max(textWidth(pill.caption, font, pad), textWidth(pill.measures, font, pad));
  return (
    <Group
      x={pill.x + 8 / s}
      y={pill.y + 8 / s}
      name="scn-template-label"
      id={id}
      opacity={pill.hidden ? 0.6 : 1}
      {...(pill.hovered && { hovered: true })}
    >
      <Rect
        width={width}
        height={2 * line + pad}
        fill={colors.background}
        opacity={0.85}
        cornerRadius={4 / s}
      />
      <Circle
        name="scn-template-label-dot"
        x={pad + dot / 2}
        y={(line + pad) / 2}
        radius={dot / 2}
        fill={pill.color}
        stroke={CASING_COLOR}
        strokeWidth={1 / s}
      />
      <Text
        x={lead}
        text={pill.caption}
        fontSize={font}
        padding={pad}
        fill={colors.foreground}
        name="scn-template-label-text"
      />
      <Text
        x={lead}
        y={line}
        text={pill.measures}
        fontSize={font}
        padding={pad}
        fill={colors.foreground}
        name="scn-template-label-measures"
      />
    </Group>
  );
}

export function ScnTemplateLabelsLayer() {
  const byId = useTemplatePills((s) => s.byId);
  return (
    <Group listening={false}>
      {Object.entries(byId).map(([id, pill]) => (
        <TemplateLabel key={id} id={id} pill={pill} />
      ))}
    </Group>
  );
}
