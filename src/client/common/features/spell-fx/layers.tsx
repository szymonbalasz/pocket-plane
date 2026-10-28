// Spell FX canvas layer entries (FR-VFX-13, ADR-0071): the aura / hit-look passes on the `objects`
// Konva layer, `vfx-under` (38, below tokens) and `vfx-over` (43, above tokens, below labels).
// fix/vfx-core registers them drawing nothing; spell-fx's build gives them their renderers.

/** Below tokens: aura washes, rings, affected cells (FR-VFX-24). Draws nothing yet. */
export function VfxUnderLayer() {
  return null;
}

/** Above tokens, below labels: spirits, flames, hit looks. Draws nothing yet. */
export function VfxOverLayer() {
  return null;
}
