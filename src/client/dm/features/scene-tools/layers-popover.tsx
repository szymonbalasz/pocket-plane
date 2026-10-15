// DM Layers popover (FR-SCN-05, SCN §7): a rail button (`map-tool-layers`) opening one Switch per
// registered layer toggle plus "DM-only items" (`scn-layer-toggle-<key>`). Off = not drawn and
// not hit on this DM client; client only, never sent; kept per campaign in browser storage, all on
// by default. Works while not live too (FR-SCN-34).
import { Button } from "@ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Switch } from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { Label } from "@ui/components/ui/primitives";
import { browserLayerMemory, layerSwitches } from "@ui/features/scene-tools/layer-switches";
import { type LayerToggle, layerToggles } from "@ui/features/scenes-map/layers";
import { useLayerToggles } from "@ui/features/scenes-map/tool-store";
import { cn } from "@ui/lib/utils";
import { useSync } from "@ui/sync/store";
import { LayersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * The registry's toggles. `canvas-layers` pulls in every Konva layer, which lives in the lazy
 * MapCanvas chunk; it is loaded the same way here, so the rail stays light.
 */
function useSwitches(): LayerToggle[] {
  const [toggles, setToggles] = useState<LayerToggle[]>([]);
  useEffect(() => {
    let on = true;
    import("@ui/features/scenes-map/canvas-layers").then(
      (m) => on && setToggles(layerToggles(m.canvasLayers)),
      (err) => console.error("scene-tools: layer toggles failed to load", err),
    );
    return () => {
      on = false;
    };
  }, []);
  return useMemo(() => layerSwitches(toggles), [toggles]);
}

/** Loads the campaign's switches into the store on campaign change; writes them on each change. */
function useLayerMemory(campaignId: string | null) {
  const memory = useMemo(browserLayerMemory, []);
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (campaignId === null) return;
    useLayerToggles.getState().replace(memory.read(campaignId));
    setLoaded(campaignId);
  }, [campaignId, memory]);
  const off = useLayerToggles((s) => s.off);
  useEffect(() => {
    if (campaignId !== null && loaded === campaignId) memory.write(campaignId, off);
  }, [campaignId, loaded, off, memory]);
}

export function ScnLayersPopover() {
  const campaignId = useSync((s) => s.store.you?.campaignId ?? null);
  useLayerMemory(campaignId);
  const off = useLayerToggles((s) => s.off);
  const setOn = useLayerToggles((s) => s.setOn);
  const [open, setOpen] = useState(false);
  const switches = useSwitches();
  const anyOff = switches.some((t) => off[t.key]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={anyOff ? "Layers — some hidden" : "Layers"}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn("relative size-9", open && "bg-accent")}
            aria-label="Layers"
            data-testid="map-tool-layers"
            data-some-off={anyOff ? "true" : "false"}
          >
            <LayersIcon className="size-4" />
            {anyOff && (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
              />
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="flex w-56 flex-col gap-2"
        data-testid="scn-layers"
      >
        <p className="text-sm font-medium">Layers</p>
        {switches.map((t) => {
          const id = `scn-layer-toggle-${t.key}`;
          return (
            <div key={t.key} className="flex items-center justify-between gap-2">
              <Label htmlFor={id} className="text-xs">
                {t.label}
              </Label>
              <Switch
                id={id}
                data-testid={id}
                checked={!off[t.key]}
                onCheckedChange={(on) => setOn(t.key, on)}
              />
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Only on this screen; players are unaffected.
        </p>
      </PopoverContent>
    </Popover>
  );
}
