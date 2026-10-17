// The dice settings (FR-DICEX-36, DICEX §7 "Settings popover"), the content of the tray's gear
// popover and of the roll popup's gear: Display Full screen / Tray throw / Flat / Off, "Show
// others' rolls", "Roll popups", "Dice look…". Reduced motion / no WebGL: the 3D modes are
// disabled with the reason (the stored setting is kept, FR-DICEX-32).
import { Button } from "../../components/ui/button";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { useSync } from "../../sync/store";
import { LookEditor } from "./LookEditor";
import { useThreeD } from "./lazy3d";
import { DisplaySetting, is3dDisplay, useDiceSettings } from "./settings";

const DISPLAY_LABEL: Record<DisplaySetting, string> = {
  screen: "Full screen",
  zone: "Tray throw",
  flat: "Flat",
  off: "Off",
};

export type SettingsPane = "settings" | "look";

export function SettingsPanel({
  pane,
  onPane,
}: {
  pane: SettingsPane;
  onPane(pane: SettingsPane): void;
}) {
  const { settings, display, reducedMotion, set } = useDiceSettings();
  const threeD = useThreeD();
  const live = useSync((s) => s.state === "live");
  const no3d = reducedMotion || !threeD.available;
  return pane === "look" ? (
    <LookEditor onBack={() => onPane("settings")} />
  ) : (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Dice on this device</p>
        <ToggleGroup
          type="single"
          aria-label="Dice display"
          value={display}
          onValueChange={(v) => {
            if (v) set({ display: v as DisplaySetting });
          }}
        >
          {DisplaySetting.options.map((d) => (
            <ToggleGroupItem
              key={d}
              value={d}
              data-testid="dicex-settings-display"
              data-value={d}
              disabled={no3d && is3dDisplay(d)}
              className="h-7 px-2 text-xs"
            >
              {DISPLAY_LABEL[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {(reducedMotion || threeD.reason) && (
          <p data-testid="dicex-settings-3d-hint" className="text-xs text-muted-foreground">
            {reducedMotion
              ? "Reduced motion is on: dice show flat."
              : threeD.reason === "no-webgl"
                ? "3D unavailable on this device"
                : "3D dice couldn't load: dice show flat this session."}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id="dicex-settings-others"
          data-testid="dicex-settings-others"
          checked={settings.others}
          onCheckedChange={(v) => set({ others: v })}
        />
        <label htmlFor="dicex-settings-others">Show others' rolls</label>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id="dicex-settings-popup"
          data-testid="dicex-settings-popup"
          checked={settings.popup}
          onCheckedChange={(v) => set({ popup: v })}
        />
        <label htmlFor="dicex-settings-popup">Roll popups</label>
      </div>
      <Button
        data-testid="dicex-look-open"
        size="sm"
        variant="outline"
        disabled={!live}
        onClick={() => onPane("look")}
      >
        Dice look…
      </Button>
    </>
  );
}
