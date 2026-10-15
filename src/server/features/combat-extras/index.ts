// combat-extras (CBTX): effects, temp HP, death saves, concentration, add combatants mid-fight.
// Record type `effect`; `cbtx.*` intents; `hpRules` (used by combat-tracker and the sheet);
// rule hooks, token-changed hook and the `cbtx-concentration` kind are registry lines.
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { combatRuleHooksOf } from "../combat-tracker/rule-hooks";
import { addCombatantsCommand } from "./add-combatants";
import { bindToken } from "./bind-token";
import { rollConcentration } from "./concentration";
import { addEffect, endEffect, setConcentration, updateEffect } from "./effect-commands";
import { rollDeathSave, setDeathSaves, setTempHp } from "./play-state";
import { effectRecordType } from "./records";

export { hpRules } from "./hp-rules";

export const combatExtras: Feature = {
  name: "combat-extras",
  register(r) {
    const intents: CommandDef[] = [
      addEffect,
      updateEffect,
      endEffect,
      setConcentration,
      setTempHp,
      rollConcentration,
      rollDeathSave,
      setDeathSaves,
      // combat-tracker registers first (feature order) and binds the hook list.
      addCombatantsCommand(combatRuleHooksOf(r.services)),
      bindToken,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    r.recordType(effectRecordType);
  },
};
