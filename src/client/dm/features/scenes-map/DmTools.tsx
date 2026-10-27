// DM tool rail extras (MAP §7): grid calibration popover (FR-MAP-10), map lock (FR-MAP-11).
// Disabled while not live (FR-MAP-28). "Show to players" lives in the Scenes window (FR-MAP-51).
import { GridFields, MAP_INTENTS, type SceneRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Slider, Switch } from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import type { EffectiveGrid } from "@ui/features/scenes-map/canvas-context";
import { toastReject, useLive, useMapIntent } from "@ui/features/scenes-map/intents";
import { RAIL_TOOL } from "@ui/features/scenes-map/ToolRail";
import { cn } from "@ui/lib/utils";
import { Grid3x3Icon, LockIcon, MinusIcon, PlusIcon, UnlockIcon } from "lucide-react";
import { useState } from "react";
import { useDmMap } from "./view-state";

const gridOf = (s: SceneRecord): EffectiveGrid => ({
  gridCellSize: s.gridCellSize,
  gridOffsetX: s.gridOffsetX,
  gridOffsetY: s.gridOffsetY,
  gridVisible: s.gridVisible,
  gridColor: s.gridColor,
  gridOpacity: s.gridOpacity,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

function NumberField({
  id,
  label,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  onChange(v: number): void;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          aria-label={`${label} −${step}`}
          data-testid={`${id}-dec`}
          onClick={() => onChange(round2(value - step))}
        >
          <MinusIcon className="size-3" />
        </Button>
        <Input
          id={id}
          data-testid={id}
          type="number"
          step="0.01"
          className="h-7 text-center"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        />
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          aria-label={`${label} +${step}`}
          data-testid={`${id}-inc`}
          onClick={() => onChange(round2(value + step))}
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/** FR-MAP-10: edits preview locally; Save sends one `map.setGrid`, Cancel restores. */
export function GridTool({ scene }: { scene: SceneRecord }) {
  const live = useLive();
  const send = useMapIntent();
  const draft = useDmMap((s) => s.gridDraft);
  const setDraft = useDmMap((s) => s.setGridDraft);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const g = draft?.sceneId === scene.id ? draft.grid : gridOf(scene);
  const disabled = scene.mapLocked || !live;
  const set = (patch: Partial<EffectiveGrid>) =>
    setDraft({ sceneId: scene.id, grid: { ...g, ...patch } });
  const parsed = GridFields.safeParse({
    cellSize: g.gridCellSize,
    offsetX: g.gridOffsetX,
    offsetY: g.gridOffsetY,
    visible: g.gridVisible,
    color: g.gridColor,
    opacity: g.gridOpacity,
  });
  const close = () => {
    setDraft(null);
    setOpen(false);
  };

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(o) => {
        if (o) {
          setDraft({ sceneId: scene.id, grid: gridOf(scene) });
          setOpen(true);
        } else close();
      }}
    >
      <Tooltip content={scene.mapLocked ? "Grid — map is locked" : "Grid"}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button
            size="icon"
            variant="ghost"
            className={cn(RAIL_TOOL, open && "bg-accent")}
            aria-label="Grid"
            data-testid="map-tool-grid"
            disabled={disabled}
          >
            <Grid3x3Icon />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="flex w-80 flex-col gap-3"
        data-testid="map-grid"
      >
        <p className="text-sm font-medium">Grid</p>
        <NumberField
          id="map-grid-cell"
          label="Cell (px)"
          value={g.gridCellSize}
          step={1}
          onChange={(v) => set({ gridCellSize: v })}
        />
        <NumberField
          id="map-grid-offset-x"
          label="Offset X"
          value={g.gridOffsetX}
          step={1}
          onChange={(v) => set({ gridOffsetX: v })}
        />
        <NumberField
          id="map-grid-offset-y"
          label="Offset Y"
          value={g.gridOffsetY}
          step={1}
          onChange={(v) => set({ gridOffsetY: v })}
        />
        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
          <Label htmlFor="map-grid-visible" className="text-xs">
            Visible
          </Label>
          <Switch
            id="map-grid-visible"
            data-testid="map-grid-visible"
            checked={g.gridVisible}
            onCheckedChange={(v) => set({ gridVisible: v })}
          />
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
          <Label htmlFor="map-grid-color" className="text-xs">
            Colour
          </Label>
          <input
            id="map-grid-color"
            data-testid="map-grid-color"
            type="color"
            className="h-7 w-14 cursor-pointer rounded border bg-transparent"
            value={g.gridColor}
            onChange={(e) => set({ gridColor: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
          <Label className="text-xs">Opacity</Label>
          <Slider
            data-testid="map-grid-opacity"
            aria-label="Opacity"
            min={0.1}
            max={1}
            step={0.1}
            value={[g.gridOpacity]}
            onValueChange={([v]) => v !== undefined && set({ gridOpacity: round2(v) })}
          />
          <span className="text-right text-xs tabular-nums">{g.gridOpacity.toFixed(1)}</span>
        </div>
        {!parsed.success && (
          <p className="text-xs text-destructive" data-testid="map-grid-error">
            {parsed.error.issues[0]?.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" data-testid="map-grid-cancel" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="map-grid-save"
            disabled={!parsed.success || busy || !live}
            onClick={() => {
              if (!parsed.success) return;
              setBusy(true);
              send(MAP_INTENTS.setGrid, { sceneId: scene.id, ...parsed.data })
                .then(close, toastReject)
                .finally(() => setBusy(false));
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** FR-MAP-11. */
export function LockTool({ scene }: { scene: SceneRecord }) {
  const live = useLive();
  const send = useMapIntent();
  const Icon = scene.mapLocked ? LockIcon : UnlockIcon;
  return (
    <Tooltip content={scene.mapLocked ? "Unlock map" : "Lock map"}>
      <Button
        size="icon"
        variant="ghost"
        className={cn(RAIL_TOOL, scene.mapLocked && "bg-accent")}
        aria-label={scene.mapLocked ? "Unlock map" : "Lock map"}
        aria-pressed={scene.mapLocked}
        data-testid="map-tool-lock"
        data-locked={scene.mapLocked}
        disabled={!live}
        onClick={() =>
          send(MAP_INTENTS.setLocked, { sceneId: scene.id, locked: !scene.mapLocked }).catch(
            toastReject,
          )
        }
      >
        <Icon />
      </Button>
    </Tooltip>
  );
}
