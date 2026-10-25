// Identity chip (FR-SHELL-70): the far right of the top bar, both clients. "● Name ⚙" in the
// viewer's colour; opens Preferences (`shell.prefs`, no launcher entry), restores it when
// minimised, closes it when on top. Players see the sound state after the name (the speaker
// Button retired, FR-SHELL-24 / -73). Browser-only: works while not `live`.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { SettingsIcon, VolumeOffIcon, VolumeXIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import { type SpeakerState, speakerState } from "./alerts";
import { topWindow, type WindowAction, type Windows } from "./manager";
import { PREFS_KIND } from "./PreferencesWindow";
import type { ShellClient } from "./registry";
import { useAlertState, useAvailableKinds, useShellState, useWindowDispatch } from "./ShellContext";

export type PrefsState = "closed" | "open" | "minimised";

/** The chip's `data-state`: Preferences' window state (closed when not in the layout). */
export function prefsState(windows: Windows): PrefsState {
  return windows.find((w) => w.kind === PREFS_KIND)?.state ?? "closed";
}

/** A click: on top → close; closed / minimised / behind → open with `by: "user"` (front, restore). */
export function chipAction(windows: Windows, available: ReadonlySet<string>): WindowAction {
  const top = topWindow(windows, available);
  return top?.kind === PREFS_KIND
    ? { type: "close", kind: PREFS_KIND }
    : { type: "open", kind: PREFS_KIND, by: "user" };
}

const SOUND_TIP: Record<SpeakerState, string> = {
  on: "",
  muted: " · sound muted",
  locked: " · click anywhere to enable sounds",
};

/** Tooltip text: "Preferences", plus the players' sound state. */
export const chipTip = (sound: SpeakerState | null) =>
  `Preferences${sound ? SOUND_TIP[sound] : ""}`;

const SOUND_ICON = { muted: VolumeXIcon, locked: VolumeOffIcon } as const;

export interface ChipViewProps {
  name: string;
  /** The CSS colour drawn (`colorOf(you)`); null → no fill. */
  color: string | null;
  state: PrefsState;
  /** Players' sound state; null on the DM. */
  sound: SpeakerState | null;
  onClick?: () => void;
}

/** The chip as drawn: dot, name, the players' muted / locked glyph, settings icon. */
export function ChipView({ name, color, state, sound, onClick }: ChipViewProps) {
  const SoundIcon = sound === "muted" || sound === "locked" ? SOUND_ICON[sound] : null;
  return (
    <Tooltip content={chipTip(sound)}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2"
        data-testid="ui-prefs-open"
        data-state={state}
        data-sound-state={sound ?? undefined}
        aria-label={chipTip(sound)}
        onClick={onClick}
      >
        {/* Icons ignore the pointer: the unlock on this pointerdown may swap one (FR-SHELL-25). */}
        <span
          aria-hidden
          data-testid="ui-prefs-chip-dot"
          data-color={color ?? undefined}
          className="pointer-events-none size-3 shrink-0 rounded-full ring-1 ring-swatch-ink/60"
          style={color ? { backgroundColor: color } : undefined}
        />
        <span className="pointer-events-none max-w-40 truncate">{name}</span>
        {SoundIcon && (
          <SoundIcon
            data-testid="ui-prefs-chip-sound"
            className="pointer-events-none size-4 text-muted-foreground"
          />
        )}
        <SettingsIcon className="pointer-events-none size-3.5 text-muted-foreground" />
      </Button>
    </Tooltip>
  );
}

export function IdentityChip({ client }: { client: ShellClient }) {
  const you = useSync((s) => s.store.you);
  const players = useSync((s) => s.store.records.player);
  const colorOf = useColorOf();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const dispatch = useWindowDispatch();
  const speaker = useAlertState(speakerState);
  const playerId = you?.playerId ?? undefined;
  const name =
    client === "dm" ? "DM" : ((players?.[playerId ?? ""] as PlayerRecord | undefined)?.name ?? "");
  const color = you
    ? colorOf(client === "dm" ? { role: "dm" } : { role: "player", playerId })
    : null;
  return (
    <ChipView
      name={name}
      color={color}
      state={prefsState(windows)}
      sound={client === "player" ? speaker : null}
      onClick={() => dispatch(chipAction(windows, available))}
    />
  );
}
