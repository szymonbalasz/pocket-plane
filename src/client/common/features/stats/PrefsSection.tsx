// Preferences "Stats" section (FR-STATS-30, -34; FR-SHELL-72 order 40), both clients: the
// per-browser "Kill feed" and "Open the fight summary at End" switches (`./prefs`).
import { Switch } from "../../components/ui/controls";
import { definePrefSection } from "../play-shell/PreferencesWindow";
import { type StatsPrefs, statsPrefs, useStatsPrefs } from "./prefs";

const SWITCHES: { key: keyof StatsPrefs; testId: string; label: string }[] = [
  { key: "feed", testId: "stats-pref-feed", label: "Kill feed" },
  { key: "openSummary", testId: "stats-pref-summary", label: "Open the fight summary at End" },
];

export function StatsPrefsSection() {
  const prefs = useStatsPrefs();
  return (
    <div data-testid="stats-prefs" className="flex flex-col gap-2">
      {SWITCHES.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-sm">
          <Switch
            id={s.testId}
            data-testid={s.testId}
            checked={prefs[s.key]}
            onCheckedChange={(v) => statsPrefs().write({ [s.key]: v })}
          />
          <label htmlFor={s.testId}>{s.label}</label>
        </div>
      ))}
    </div>
  );
}

export const statsPrefSection = definePrefSection({
  id: "stats.prefs",
  title: "Stats",
  order: 40,
  Component: StatsPrefsSection,
});
