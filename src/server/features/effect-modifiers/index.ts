// effect-modifiers (MOD): `mod.*` intents, record types `effect-preset` and `rule-trigger`
// (lazy, ADR-0045). Registry lines elsewhere: the roll hooks (`rollHooks`, dice-roll-log), the
// apply hook (`applyHooks`, combat-tracker), the turn-start reminders (`combatRuleHooks`), the
// notification kind `mod-trigger` and the owner copies (entities' definition-changed hooks).
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { applyPreset, deletePreset, putPreset, setModifiers, togglePreset } from "./commands";
import { effectPresetRecordType } from "./records";
import { deleteTrigger, putTrigger } from "./trigger-commands";
import { ruleTriggerRecordType } from "./trigger-records";

/** FR-MOD-46: the compendium's `cmp.addToSheet` calls it in its own transaction. */
export { addTriggerFromPreset } from "./trigger-commands";

export const effectModifiers: Feature = {
  name: "effect-modifiers",
  register(r) {
    const intents = [
      putPreset,
      deletePreset,
      applyPreset,
      togglePreset,
      setModifiers,
      putTrigger,
      deleteTrigger,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    r.recordType(effectPresetRecordType);
    r.recordType(ruleTriggerRecordType);
  },
};
