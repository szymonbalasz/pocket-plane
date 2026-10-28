// spell-fx (VFX, ADR-0071): no record type of its own (`fx` rides combat-extras' `effect`).
// Intents `vfx.cast`, `vfx.setEffectFx`; the server signal `vfx.hit` and its after-commit
// listener on `AttackApplied` / `HpApplied` (hit cues, never stored).
import { HitCue, VFX_HIT_SIGNAL } from "@shared/spell-fx/cue";
import type { Feature } from "../../services";
import { defineServerSignal } from "../../ws/signals";
import { cast, setEffectFx } from "./commands";
import { hitCueListener } from "./cues";

export const hitCueSignal = defineServerSignal({ name: VFX_HIT_SIGNAL, schema: HitCue });

export const spellFx: Feature = {
  name: "spell-fx",
  register(r) {
    r.command(cast, { intent: true });
    r.command(setEffectFx, { intent: true });
    r.services.signals.registerServer(hitCueSignal);
    r.listener("spell-fx.hit-cues", hitCueListener(r.services));
  },
};
