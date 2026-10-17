// The fog bar's sprint-4 blocks (FR-FOG-55, -56), kept apart from `FogBar.tsx`: the brush radius
// Slider (`fog-brush-radius`, `data-value` = ft; 0–50, step 5, kept per browser), shown while the
// Brush shape is picked, and the Redo button (`fog-redo`, `data-depth`, Tooltip naming the step).
import type { FogRecord } from "@shared/fog-of-war/schemas";
import { Redo2Icon } from "lucide-react";
import { useId } from "react";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { BRUSH_FT } from "./brush";
import { setBrushFt, useFogTool } from "./store";

/** FR-FOG-55: the radius Slider ("10 ft"). */
export function BrushRadius({ disabled }: { disabled: boolean }) {
  const ft = useFogTool((s) => s.brushFt);
  const id = useId();
  return (
    <div className="flex items-center gap-2 px-1 text-xs">
      <span id={id} className="text-muted-foreground">
        Radius
      </span>
      <Slider
        data-testid="fog-brush-radius"
        data-value={ft}
        aria-labelledby={id}
        className="w-24"
        min={BRUSH_FT.min}
        max={BRUSH_FT.max}
        step={BRUSH_FT.step}
        value={[ft]}
        disabled={disabled}
        onValueChange={([v]) => {
          if (v !== undefined) setBrushFt(v);
        }}
      />
      <span className="w-10 tabular-nums" data-testid="fog-brush-radius-label">
        {ft} ft
      </span>
    </div>
  );
}

/** FR-FOG-56: Redo; disabled with nothing undone. */
export function RedoButton({
  fog,
  disabled,
  hint,
  onRedo,
}: {
  fog: FogRecord | undefined;
  disabled: boolean;
  hint: string;
  onRedo: () => void;
}) {
  const redo = fog?.redo;
  const off = disabled || !redo;
  const button = (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label="Redo"
      data-testid="fog-redo"
      data-depth={redo?.n ?? 0}
      disabled={off}
      onClick={onRedo}
    >
      <Redo2Icon className="size-4" />
    </Button>
  );
  return (
    <Tooltip content={hint}>
      {/* A disabled button gets no pointer events: the wrapper carries the tooltip. */}
      {off ? <span className="inline-flex">{button}</span> : button}
    </Tooltip>
  );
}
