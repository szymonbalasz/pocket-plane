// Preferences "Appearance" section (theme-system FR-THEME-02, -20; FR-SHELL-72), both clients:
// one option card per theme, each with a small preview drawn from that theme's own tokens (the
// swatch carries `data-theme`, so it shows the theme whatever the page uses). A pick applies at
// once, no reload; the choice is this browser's only (FR-THEME-03).

import { definePrefSection } from "../features/play-shell/PreferencesWindow";
import { cn } from "../lib/utils";
import { THEME_IDS, THEME_LABELS, type ThemeId, themeStore, useTheme } from "./theme";

/** Panel, frame, accent and a display type sample, in the theme's tokens. */
function ThemeSwatch({ id }: { id: ThemeId }) {
  return (
    <span
      data-theme={id}
      aria-hidden
      className="flex h-12 items-stretch rounded-sm bg-background p-1.5 text-foreground"
    >
      <span className="flex flex-1 flex-col justify-between rounded-sm border border-[color:var(--frame-rule)] bg-card px-1.5 py-1">
        <span className="font-[family-name:var(--font-title)] text-sm leading-none text-primary">
          Aa
        </span>
        <span className="h-1 w-6 rounded-full bg-[color:var(--gem)]" />
      </span>
    </span>
  );
}

export function AppearanceSection({
  current,
  onPick,
}: {
  current: ThemeId;
  onPick(theme: ThemeId): void;
}) {
  return (
    <div data-testid="theme-section" className="flex flex-col gap-2">
      <div className="flex gap-2">
        {THEME_IDS.map((id) => {
          const on = id === current;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              data-testid="theme-option"
              data-value={id}
              data-state={on ? "on" : "off"}
              onClick={() => onPick(id)}
              className={cn(
                "flex flex-1 flex-col gap-1.5 rounded-md border p-1.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-ring ring-1 ring-ring" : "hover:border-ring/60",
              )}
            >
              <ThemeSwatch id={id} />
              <span className="font-medium">{THEME_LABELS[id]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Only on this browser</p>
    </div>
  );
}

function Appearance() {
  return <AppearanceSection current={useTheme()} onPick={(t) => themeStore().write(t)} />;
}

export const appearanceSection = definePrefSection({
  id: "theme.appearance",
  title: "Appearance",
  order: 15,
  Component: Appearance,
});
