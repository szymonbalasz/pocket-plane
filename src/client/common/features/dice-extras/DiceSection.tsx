// Preferences "Dice" section (FR-DICEX-57, FR-SHELL-72 order 30), both clients: the tray / popup
// gears' settings panel in the 360-px window, "Dice look…" opening the look pane in place. Same
// stores as the gears (FR-DICEX-58): `pp.dicex.v2` via `useDiceSettings`, the `dice-look` record.
// The panel is the lazy chunk the roll popup's gear already loads (initial JS unchanged).
import { lazy, Suspense, useState } from "react";
import { definePrefSection } from "../play-shell/PreferencesWindow";
import type { SettingsPane } from "./SettingsPanel";

const SettingsPanel = lazy(() =>
  import("./SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);

/** The section body; `initialPane` only for tests (the window always opens on the settings). */
export function DiceSection({ initialPane = "settings" }: { initialPane?: SettingsPane }) {
  const [pane, setPane] = useState<SettingsPane>(initialPane);
  return (
    <div data-testid="dicex-prefs" data-pane={pane} className="flex flex-col gap-3">
      <Suspense fallback={null}>
        <SettingsPanel pane={pane} onPane={setPane} />
      </Suspense>
    </div>
  );
}

export const diceSection = definePrefSection({
  id: "dicex.dice",
  title: "Dice",
  order: 30,
  Component: () => <DiceSection />,
});
