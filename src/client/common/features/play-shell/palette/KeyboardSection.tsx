// Preferences → Keyboard (FR-SHELL-193, WCAG 2.1.4; both clients' `pref-sections.ts`): one Switch
// "Single-key shortcuts" (default on), per browser `pp.keys.v1` (device-wide, not per campaign).
// Off → only Ctrl / ⌘ chords work; the shortcuts sheet marks the others "Off".
import { Switch } from "../../../components/ui/menus";
import { Label } from "../../../components/ui/primitives";
import { definePrefSection } from "../PreferencesWindow";
import { openShortcuts } from "./state";
import { setSingleKey, useSingleKey } from "./storage";

function KeyboardSection() {
  const on = useSingleKey();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="ui-prefs-keys-single">Single-key shortcuts</Label>
        <Switch
          id="ui-prefs-keys-single"
          data-testid="ui-prefs-keys-single"
          checked={on}
          onCheckedChange={(v) => setSingleKey(v === true)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Letters like L (Game log) work outside text fields. Off: only Ctrl / ⌘ shortcuts.{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          data-testid="ui-prefs-keys-sheet"
          onClick={openShortcuts}
        >
          All shortcuts
        </button>
      </p>
    </div>
  );
}

export const keyboardSection = definePrefSection({
  id: "shell.keys",
  title: "Keyboard",
  order: 70,
  Component: KeyboardSection,
});
