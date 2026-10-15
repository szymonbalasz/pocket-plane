// effect-modifiers (MOD, tier 1): `mod.*` intents, record type `effect-preset`. Registry lines
// elsewhere: the roll hook (`rollHooks`, dice-roll-log) and the preset owner copy
// (entities' definition-changed hooks).
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { applyPreset, deletePreset, putPreset, setModifiers, togglePreset } from "./commands";
import { effectPresetRecordType } from "./records";

export const effectModifiers: Feature = {
  name: "effect-modifiers",
  register(r) {
    const intents = [
      putPreset,
      deletePreset,
      applyPreset,
      togglePreset,
      setModifiers,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    r.recordType(effectPresetRecordType);
  },
};
