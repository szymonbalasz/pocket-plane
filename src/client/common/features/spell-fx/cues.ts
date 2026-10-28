// Hit cue subscriber (FR-VFX-21, -22, ADR-0071): the server's transient `vfx.hit` signal, zod-parsed,
// handed to subscribers on arrival only (no queue, no replay; a malformed frame is dropped with a
// warning). No rendering here: spell-fx's build plays the looks from these cues.
import { type HitCue, HitCue as HitCueSchema, VFX_HIT_SIGNAL } from "@shared/spell-fx/cue";
import type { SignalHandler } from "../../sync/connection";
import { useSignal } from "../../sync/store";

export type HitCueHandler = (cue: HitCue) => void;

/** A signal handler that passes each well-formed `vfx.hit` to `fn`; other signals are ignored. */
export function hitCueHandler(fn: HitCueHandler): SignalHandler {
  return (s) => {
    if (s.name !== VFX_HIT_SIGNAL) return;
    const r = HitCueSchema.safeParse(s.data);
    if (!r.success) {
      console.warn("vfx.hit dropped: invalid cue", r.error.issues);
      return;
    }
    fn(r.data);
  };
}

/** Subscribes `fn` to a connection's hit cues; returns the unsubscribe. */
export function subscribeHitCues(
  connection: { onSignal(fn: SignalHandler): () => void },
  fn: HitCueHandler,
): () => void {
  return connection.onSignal(hitCueHandler(fn));
}

/** React: calls `fn` for every hit cue that arrives while mounted. */
export function useHitCues(fn: HitCueHandler): void {
  const handle = hitCueHandler(fn);
  useSignal(VFX_HIT_SIGNAL, handle);
}
