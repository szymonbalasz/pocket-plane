// A 3D throw (FR-DICEX-14, -15, -20, -23), drawn by the lazy chunk's renderer into a host div.
// Dice data stays in the DOM for walkthroughs: one hidden `dicex-throw-die` per 3D die with
// `data-settled` = the up-face read from the rendered mesh at rest. MOD / offered dice get a
// label under the die at rest.
import type { DiceLook } from "@shared/dice-extras/looks";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import type { ThrowDie } from "@shared/dice-extras/throw";
import { useEffect, useRef } from "react";
import type { PlayHandle, RestInfo } from "./dice3d/index";
import { dice3d } from "./lazy3d";

/** A die the 3D renderer draws (a mesh die with a server value); the rest stay flat chips. */
export const isMeshDie = (d: ThrowDie) => d.shape !== null && !d.flat && d.value !== null;

/** FR-DICEX-23: a median frame time above this switches the device to flat. */
export const SLOW_FRAME_MS = 33;

export function Throw3DStage({
  throwId,
  dice,
  looks,
  width,
  height,
  rest,
  interrupted,
  onRest,
  onLost,
}: {
  throwId: string;
  dice: readonly ThrowDie[];
  looks: Record<string, DiceLook>;
  width: number;
  height: number;
  rest: RestInfo | null;
  /** FR-DICEX-18: a newer throw started; snap to the final pose and hold that frame. */
  interrupted: boolean;
  onRest(info: RestInfo): void;
  onLost(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<PlayHandle | null>(null);
  const cb = useRef({ onRest, onLost });
  cb.current = { onRest, onLost };
  const input = useRef({ dice, looks, width, height });
  input.current = { dice, looks, width, height };

  // Once per throw: settle headless, then play (FR-DICEX-15).
  useEffect(() => {
    const mod = dice3d.module();
    const el = host.current;
    if (!mod || !el) {
      cb.current.onLost();
      return;
    }
    const { dice: ds, looks: ls, width: w, height: h } = input.current;
    try {
      handle.current = mod.playThrow({
        host: el,
        width: w,
        height: h,
        seed: mod.seedOf(throwId),
        dice: ds.map((d) => ({
          key: d.key,
          shape: d.shape as NonNullable<ThrowDie["shape"]>,
          ...(d.d100 && { d100: d.d100 }),
          value: d.value as number,
          kept: d.kept,
          look: ls[d.entryId] ?? STYLE_LOOK.ivory,
        })),
        onRest: (info) => cb.current.onRest(info),
        onLost: () => cb.current.onLost(),
      });
    } catch (err) {
      console.warn("Dice: WebGL could not start; showing flat dice.", err);
      cb.current.onLost();
    }
    return () => {
      handle.current?.stop();
      handle.current = null;
    };
  }, [throwId]);
  useEffect(() => {
    if (interrupted) handle.current?.freeze();
  }, [interrupted]);

  return (
    <div className="relative" style={{ width, height }}>
      <div ref={host} className="absolute inset-0" />
      {dice.map((d) => (
        <span
          key={d.key}
          data-testid="dicex-throw-die"
          data-entry-id={d.entryId}
          data-faces={d.faces}
          data-value={d.value ?? ""}
          data-kept={d.kept}
          data-flat={false}
          data-offered={d.offered === true}
          data-style={(looks[d.entryId] ?? STYLE_LOOK.ivory).style}
          data-material={(looks[d.entryId] ?? STYLE_LOOK.ivory).material}
          {...(rest && { "data-settled": rest.settled[d.key] ?? "" })}
          className="sr-only"
        />
      ))}
      {rest &&
        dice
          .filter((d) => d.label || d.offered)
          .map((d) => {
            const at = rest.at[d.key];
            if (!at) return null;
            return (
              <span
                key={d.key}
                className="absolute max-w-20 -translate-x-1/2 truncate rounded bg-background/80 px-1 text-[10px] leading-tight text-muted-foreground"
                style={{ left: at.x, top: at.y + 22 }}
              >
                {d.sign === -1 && "−"}
                {d.offered ? `${d.label ?? ""} on a hit` : d.label}
              </span>
            );
          })}
    </div>
  );
}
