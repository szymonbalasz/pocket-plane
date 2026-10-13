// Alert UI (FR-SHELL-22–25): the flash overlay and the player's top-bar speaker control. Alert
// Toasts go to the client's one Toaster (ShellToaster). State lives in the alert controller (ShellContext).
import { Volume2Icon, VolumeOffIcon, VolumeXIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Slider, Switch } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { flashAnimation, speakerState } from "./alerts";
import { useAlertController, useAlertState } from "./ShellContext";

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

const SPEAKER_TIP = {
  on: "Sound on",
  muted: "Sound muted",
  locked: "Click anywhere to enable sounds",
} as const;

const SPEAKER_ICON = { on: Volume2Icon, muted: VolumeXIcon, locked: VolumeOffIcon } as const;

/** Player top-bar speaker (FR-SHELL-24): mute, volume, Test. Browser-only settings. */
export function SoundControl() {
  const controller = useAlertController();
  const settings = useAlertState((s) => s.settings);
  const state = useAlertState(speakerState);
  const uid = useId();
  const Icon = SPEAKER_ICON[state];
  return (
    <Popover>
      <Tooltip content={SPEAKER_TIP[state]}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            data-testid="ui-sound-button"
            data-state={state}
            aria-label={`Sound settings: ${SPEAKER_TIP[state]}`}
          >
            {/* The unlock on this pointerdown swaps the icon; with the svg hit-testable the
                pressed node would vanish and the click (opening the Popover) would be lost. */}
            <Icon className="pointer-events-none size-4" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="flex w-60 flex-col gap-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <label htmlFor={`${uid}-mute`}>Mute alert sounds</label>
          <Switch
            id={`${uid}-mute`}
            data-testid="ui-sound-mute"
            checked={settings.muted}
            onCheckedChange={(muted) => controller.setSettings({ muted })}
          />
        </div>
        <div className="flex flex-col gap-2 text-sm">
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
        <Button
          size="sm"
          variant="outline"
          className="self-end"
          data-testid="ui-sound-test"
          onClick={() => controller.test()}
        >
          Test
        </Button>
      </PopoverContent>
    </Popover>
  );
}
