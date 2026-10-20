// Alert UI (FR-SHELL-22–25): the flash overlay and the players' Sound preference section
// (FR-SHELL-73; the top-bar speaker retired). Alert Toasts go to the client's one Toaster
// (ShellToaster). State lives in the alert controller (ShellContext).
import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { Slider, Switch } from "../../components/ui/menus";
import { cn } from "../../lib/utils";
import { type AlertController, flashAnimation, type SpeakerState, speakerState } from "./alerts";
import { definePrefSection } from "./PreferencesWindow";
import { useAlertController, useAlertState } from "./ShellContext";
import type { SoundSettings } from "./sound-settings";

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Full-viewport flash in the overlay layer, above dialogs (portalled to the body),
 * `pointer-events: none`, so it never blocks input. A new alert remounts it (new `key`),
 * which restarts the animation.
 */
export function AlertFlash() {
  const flash = useAlertState((s) => s.flash);
  if (!flash) return null;
  return createPortal(
    <FlashFrame key={flash.key} id={flash.id} flashKey={flash.key} />,
    document.body,
  );
}

function FlashFrame({ id, flashKey }: { id: string; flashKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const controller = useAlertController();
  const anim = useRef(flashAnimation(prefersReducedMotion())).current;
  useLayoutEffect(() => {
    const a = ref.current?.animate?.(anim.keyframes, {
      duration: anim.duration,
      easing: "ease-in-out",
    });
    const t = setTimeout(() => controller.flashEnded(flashKey), anim.duration);
    return () => {
      clearTimeout(t);
      a?.cancel();
    };
  }, [anim, controller, flashKey]);
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="ui-alert-flash"
      data-alert-id={id}
      data-variant={anim.variant}
      // Accent placeholder token (visual-direction; theme-system names it later).
      className={cn(
        "pointer-events-none fixed inset-0 z-[100] border-warning opacity-0",
        anim.variant === "pulse"
          ? "border-8 bg-warning/15"
          : "border-4 shadow-[inset_0_0_48px_var(--warning)]",
      )}
    />
  );
}

/**
 * Sound section (FR-SHELL-73, players): FR-SHELL-24's controls, key and defaults, moved. Alerts
 * read the same controller, so a change applies to the next alert.
 */
export function SoundControls({
  settings,
  state,
  controller,
}: {
  settings: SoundSettings;
  state: SpeakerState;
  controller: Pick<AlertController, "setSettings" | "test">;
}) {
  const uid = useId();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${uid}-mute`}>Mute alert sounds</label>
        <Switch
          id={`${uid}-mute`}
          data-testid="ui-sound-mute"
          checked={settings.muted}
          onCheckedChange={(muted) => controller.setSettings({ muted })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span id={`${uid}-volume`}>Volume</span>
          <span className="text-muted-foreground tabular-nums">{settings.volume}</span>
        </div>
        <Slider
          data-testid="ui-sound-volume"
          data-value={settings.volume}
          aria-labelledby={`${uid}-volume`}
          min={0}
          max={100}
          step={1}
          value={[settings.volume]}
          onValueChange={([volume]) => {
            if (volume !== undefined) controller.setSettings({ volume });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* FR-SHELL-25: the click that opened the window normally unlocked audio already. */}
        <span data-testid="ui-sound-locked" className="text-xs text-muted-foreground">
          {state === "locked" ? "Click anywhere to enable sounds" : null}
        </span>
        <Button
          size="sm"
          variant="outline"
          data-testid="ui-sound-test"
          onClick={() => controller.test()}
        >
          Test
        </Button>
      </div>
    </div>
  );
}

function SoundSection() {
  const controller = useAlertController();
  const settings = useAlertState((s) => s.settings);
  const state = useAlertState(speakerState);
  return <SoundControls settings={settings} state={state} controller={controller} />;
}

export const soundSection = definePrefSection({
  id: "shell.sound",
  title: "Sound",
  order: 20,
  Component: SoundSection,
});
