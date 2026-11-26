// AoE panel rows for template looks (SCN FR-SCN-66, -72; #466): **Look** (None + the registry's
// looks, a Tooltip with each one's examples), **Tint** (while a look is picked: the look's own
// colour first as the default, 7 more swatches and a colour input for any colour) and **Cells**
// (0–50 %, step 5). For the next placement they change the panel settings (the live ephemeral at
// once); on a selected kept template each change sends one `scn.updateTemplate` (the slider on
// release). A template a Spell FX effect draws on keeps its preset: Look is disabled.
import {
  CELL_OPACITY,
  cellOpacityOf,
  type TemplateLook,
  type TemplateRecordView,
} from "@shared/scene-tools/schemas";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Slider, ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Label } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { cn } from "../../lib/utils";
import { fxEngine } from "../spell-fx/engine";
import { lookDef, TEMPLATE_LOOK_DEFS } from "./template-looks";
import type { AoeSettings } from "./templates";

/** FR-SCN-66: the swatches after the look's own colour (smoke, darkness, fog, poison, …). */
export const TINT_SWATCHES = [
  "#7d8590",
  "#2b2d33",
  "#e6e9ee",
  "#6f9a3a",
  "#e07b39",
  "#6fa8dc",
  "#b05fb0",
] as const;

type Style = Pick<AoeSettings, "look" | "tint" | "cellOpacity">;

/** FR-SCN-72: the Spell FX preset drawing on this template, else null. */
function useAnchoredPreset(templateId: string | null): string | null {
  const engine = fxEngine();
  const snap = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  if (!templateId) return null;
  return snap.auras.find((a) => a.templateId === templateId)?.preset.label ?? null;
}

export function LookFields({
  selected,
  settings,
  onChange,
}: {
  /** The selected kept template, or null (the next placement). */
  selected: TemplateRecordView | null;
  settings: Style;
  /** Applies a change: the panel settings, or one `scn.updateTemplate` for a selected one. */
  onChange(patch: Partial<Style>): void;
}) {
  const look: TemplateLook | null = selected ? (selected.look ?? null) : settings.look;
  const tint = selected ? (selected.tint ?? null) : settings.tint;
  const opacity = selected ? (selected.cellOpacity ?? null) : settings.cellOpacity;
  const def = lookDef(look);
  const anchored = useAnchoredPreset(selected?.id ?? null);
  const shownPct = Math.round(cellOpacityOf({ look, cellOpacity: opacity }) * 100);
  // A drag previews locally; a selected template is sent once, on release.
  const [draft, setDraft] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new template or its stored value ends the draft.
  useEffect(() => setDraft(null), [selected?.id, selected?.cellOpacity]);
  const swatches = def ? [def.tint, ...TINT_SWATCHES.filter((c) => c !== def.tint)] : [];
  return (
    <div className="flex flex-col gap-2" data-testid="scn-aoe-looks">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Look</Label>
        {anchored ? (
          <Tip content={`${anchored} draws here`}>
            <p data-testid="scn-aoe-look-anchored" className="text-muted-foreground text-xs">
              {anchored}
            </p>
          </Tip>
        ) : (
          <ToggleGroup
            type="single"
            value={look ?? "none"}
            onValueChange={(v) => {
              if (!v) return;
              onChange({ look: v === "none" ? null : (v as TemplateLook) });
            }}
            aria-label="Look"
            className="flex-wrap justify-start"
          >
            <ToggleTip content="No look: the squares only">
              <ToggleGroupItem
                value="none"
                className="h-7 px-2 text-xs"
                data-testid="scn-aoe-look-none"
              >
                None
              </ToggleGroupItem>
            </ToggleTip>
            {TEMPLATE_LOOK_DEFS.map((d) => (
              <ToggleTip key={d.key} content={d.examples}>
                <ToggleGroupItem
                  value={d.key}
                  className="h-7 px-2 text-xs"
                  data-testid={`scn-aoe-look-${d.key}`}
                >
                  {d.label}
                </ToggleGroupItem>
              </ToggleTip>
            ))}
          </ToggleGroup>
        )}
      </div>
      {def && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Tint</Label>
          <div className="flex flex-wrap items-center gap-1">
            {swatches.map((c, i) => {
              const isDefault = i === 0;
              const on = isDefault ? tint === null || tint === c : tint === c;
              return (
                <Tip key={c} content={isDefault ? `${def.label}'s own colour` : c}>
                  <button
                    type="button"
                    aria-label={isDefault ? `${def.label}'s own colour` : `Tint ${c}`}
                    aria-pressed={on}
                    data-testid="scn-aoe-tint-swatch"
                    data-value={c}
                    data-default={isDefault ? "true" : undefined}
                    className={cn(
                      "size-5 rounded-full border",
                      on ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : "",
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => onChange({ tint: isDefault ? null : c })}
                  />
                </Tip>
              );
            })}
            <Tip content="Any colour">
              <input
                type="color"
                aria-label="Any colour"
                data-testid="scn-aoe-tint-custom"
                className="size-6 cursor-pointer rounded border bg-transparent p-0"
                value={tint ?? def.tint}
                onChange={(e) => onChange({ tint: e.target.value.toLowerCase() })}
              />
            </Tip>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Cells</Label>
          <span className="text-muted-foreground text-xs tabular-nums">{draft ?? shownPct} %</span>
        </div>
        <Slider
          data-testid="scn-aoe-cells"
          data-value={draft ?? shownPct}
          aria-label="Cell opacity"
          min={CELL_OPACITY.min}
          max={CELL_OPACITY.max}
          step={CELL_OPACITY.step}
          value={[draft ?? shownPct]}
          onValueChange={([v]) => {
            if (v === undefined) return;
            setDraft(v);
            if (!selected) onChange({ cellOpacity: v });
          }}
          onValueCommit={([v]) => {
            if (v === undefined) return;
            if (selected) onChange({ cellOpacity: v });
            else setDraft(null);
          }}
        />
      </div>
    </div>
  );
}
