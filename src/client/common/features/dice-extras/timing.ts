// FR-DICEX-35 (OQ-DICEX-18): every dice-display duration, in one module (ms).

/** Dice rest within this (the 150-step budget at 60 Hz); a throw not at rest by then snaps. */
export const SETTLE_MAX_MS = 2500;
/** At rest this long, then the hand-off to the popup (popups on). */
export const REST_MS = 1000;
/** Rested dice shrink into their popup's PiP (D7; until then they fade over this). */
export const HANDOFF_MS = 400;
/** Popups off: at rest this long, then the fade (FR-DICEX-17). */
export const REST_NO_POPUP_MS = 1500;
/** The fade with popups off. */
export const FADE_MS = 300;
/** Flat dice: faces fade in within this (FR-DICEX-41 c). */
export const FLAT_IN_MS = 300;
/** FR-DICEX-09: a pending throw ends after this long without an own `roll` entry. */
export const PENDING_MS = 3000;
/** FR-DICEX-37: a throw arriving while the 3D chunk loads waits this long, then draws flat. */
export const CHUNK_WAIT_MS = 1500;
/** FR-DICEX-37: no `requestIdleCallback` → preload this long after the first snapshot. */
export const IDLE_FALLBACK_MS = 2000;
