// FR-DICE-68: an entry action's confirm ("Spend?" ✓ ✗) lifetime, one per action Button. It closes
// itself after `ACTION_CONFIRM_MS` unless a roll action's physical-dice form is open: the form
// stops the timer (GM1 walkthrough f2); closing the form without sending restarts it. Every close
// that sent nothing calls `onClose` (the Button resets its roll control, so the next ✓ opens a
// fresh form). Client memory only.
import { createStore, type StoreApi } from "zustand";

/** FR-DICE-68: how long an action's confirm stays open without a form. */
export const ACTION_CONFIRM_MS = 4000;

export interface ConfirmState {
  asking: boolean;
  /** A roll action's physical form is open (the timer is stopped). */
  form: boolean;
}

export interface ConfirmTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface ActionConfirm {
  api: StoreApi<ConfirmState>;
  ask(): void;
  /** The roll control's form opened (true) or closed (false). */
  form(open: boolean): void;
  /** ✗, or the timer: closes and calls `onClose`. */
  cancel(): void;
  /** Sent (✓ on a plain action, or the form's roll): closes, no `onClose`. */
  done(): void;
}

// Browser timers throw "Illegal invocation" when called with another `this`.
const globalTimers: ConfirmTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createActionConfirm(
  onClose: () => void,
  timers: ConfirmTimers = globalTimers,
): ActionConfirm {
  const api = createStore<ConfirmState>()(() => ({ asking: false, form: false }));
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const close = (sent: boolean) => {
    stop();
    const was = api.getState();
    api.setState({ asking: false, form: false });
    if (!sent && was.asking) onClose();
  };
  const start = () => {
    stop();
    timer = timers.setTimeout(() => {
      timer = null;
      if (!api.getState().form) close(false);
    }, ACTION_CONFIRM_MS);
  };
  return {
    api,
    ask() {
      api.setState({ asking: true, form: false });
      start();
    },
    form(open) {
      const s = api.getState();
      if (!s.asking || s.form === open) return;
      api.setState({ form: open });
      if (open) stop();
      else start();
    },
    cancel: () => close(false),
    done: () => close(true),
  };
}
