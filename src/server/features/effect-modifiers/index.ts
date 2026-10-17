// effect-modifiers (MOD): `mod.*` intents, record types `effect-preset`, `rule-trigger`
// (lazy, ADR-0045) and `trigger-state` (in the snapshot, ADR-0049). Registry lines elsewhere: the roll hooks (`rollHooks`, dice-roll-log), the
// apply hook (`applyHooks`, combat-tracker), the turn-start reminders (`combatRuleHooks`), the
// notification kind `mod-trigger` and the owner copies (entities' definition-changed hooks).
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import {
  applyPreset,
  deletePreset,
  putPreset,
  putPresetWithUses,
  setModifiers,
  togglePreset,
} from "./commands";
import { effectPresetRecordType } from "./records";
import { deleteTrigger, putTrigger } from "./trigger-commands";
import { ruleTriggerRecordType } from "./trigger-records";
import { triggerStateRecordType } from "./trigger-state";

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
    // Fixtures only (not an intent): a preset linked to a feature row by name (tier 3).
    r.command(putPresetWithUses as unknown as CommandDef);
    r.recordType(effectPresetRecordType);
    r.recordType(ruleTriggerRecordType);
    r.recordType(triggerStateRecordType);
  },
};
