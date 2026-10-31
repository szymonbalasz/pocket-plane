// spell-fx (VFX, ADR-0071): no record type of its own (`fx` rides combat-extras' `effect`).
// Intents `vfx.cast`, `vfx.setEffectFx`; the server signal `vfx.hit` and its after-commit
// listener on `AttackApplied` / `HpApplied` (hit cues, never stored); the server signal `vfx.poof`
// and its listener on a teleport's `TokenMoved` (FR-MAP-122).
import { HitCue, PoofCue, VFX_HIT_SIGNAL, VFX_POOF_SIGNAL } from "@shared/spell-fx/cue";
import type { Feature } from "../../services";
import { defineServerSignal } from "../../ws/signals";
import { cast, setEffectFx } from "./commands";
import { hitCueListener, poofCueListener } from "./cues";

export const hitCueSignal = defineServerSignal({ name: VFX_HIT_SIGNAL, schema: HitCue });
export const poofCueSignal = defineServerSignal({ name: VFX_POOF_SIGNAL, schema: PoofCue });

export const spellFx: Feature = {
  name: "spell-fx",
  register(r) {
    r.command(cast, { intent: true });
    r.command(setEffectFx, { intent: true });
    r.services.signals.registerServer(hitCueSignal);
    r.services.signals.registerServer(poofCueSignal);
    r.listener("spell-fx.hit-cues", hitCueListener(r.services));
    r.listener("spell-fx.poof-cues", poofCueListener(r.services));
  },
};
