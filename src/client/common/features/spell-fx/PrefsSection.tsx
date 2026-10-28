// Preferences "Map effects" (FR-VFX-25–27; FR-SHELL-72 order 35), both clients: the per-browser
// four-way choice Full · Reduced · Still · Off (`pp.vfx`), a one-line hint, and the slow-frames
// note once this page lowered the tier (`vfx-pref-lowered`).
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { definePrefSection } from "../play-shell/PreferencesWindow";
import { FX_LEVEL_LABEL, FX_LEVELS, FxLevel, useVfxLevel, vfxPrefs } from "./prefs";

const HINT: Record<FxLevel, string> = {
  full: "Auras move and hits play on the map.",
  reduced: "Fewer particles and short trails.",
  still: "Auras hold still; hits still play once.",
  off: "No map effects in this browser.",
};

export function VfxPrefsSection() {
  const { chosen, lowered } = useVfxLevel();
  return (
    <div data-testid="vfx-prefs" className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        aria-label="Map effects"
        value={chosen}
        onValueChange={(v) => {
          const r = FxLevel.safeParse(v);
          if (r.success) vfxPrefs().write(r.data);
        }}
        className="w-fit"
      >
        {FX_LEVELS.map((l) => (
          <ToggleGroupItem key={l} value={l} data-testid={`vfx-pref-level-${l}`}>
            {FX_LEVEL_LABEL[l]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{HINT[chosen]}</p>
      {lowered && chosen !== "off" && (
        <p data-testid="vfx-pref-lowered" className="text-xs text-muted-foreground">
          Lowered to {FX_LEVEL_LABEL[lowered]} on this device: slow frames
        </p>
      )}
    </div>
  );
}

export const vfxPrefSection = definePrefSection({
  id: "vfx.level",
  title: "Map effects",
  order: 35,
  Component: VfxPrefsSection,
});
