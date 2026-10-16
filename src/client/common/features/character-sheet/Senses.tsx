// Senses (CHARX sprint 3, FR-CHARX-50 / -53): the Main tab line under the stat row, both creature
// kinds; display only, no roll button. Edit mode: vision / darkvision (number inputs, ±5), the
// "Sees through magical darkness" Switch and the DM-only "Sees invisible" Switch (disabled for the
// owner). Values are written by `char.edit {set: {senses}}`; FOG reads them server-side.
import type { Senses } from "@shared/entities/schemas";
import { useId } from "react";
import { Switch } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { IntField, useBusy } from "./fields";
import { useSheet, useSheetIntents } from "./sheet-context";
import { sensesEdit, sensesText } from "./view-model";

export const DARKNESS_HINT = "Devil's Sight and similar: see normally in magical darkness";
/** FR-CHARX-53: the owner's Switch is disabled and says why. */
export const invisibleHint = (client: "dm" | "player") =>
  client === "dm" ? "Truesight, See Invisibility and similar" : "Only the DM sets this";

function SenseSwitch(p: {
  testId: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  /** Owner view of a DM-only switch (`data-disabled`, FR-CHARX-53). */
  locked?: boolean;
  onChange(v: boolean): void;
}) {
  const id = useId();
  return (
    <Tooltip content={p.hint}>
      <span className="flex items-center gap-1.5 text-xs">
        <Switch
          id={id}
          data-testid={p.testId}
          aria-label={p.label}
          checked={p.checked}
          disabled={p.disabled || p.locked}
          onCheckedChange={p.onChange}
        />
        <label htmlFor={id} className={p.locked ? "text-muted-foreground" : undefined}>
          {p.label}
        </label>
      </span>
    </Tooltip>
  );
}

function SensesEditor({ senses }: { senses: Senses | undefined }) {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const commit = (patch: Partial<Senses>) =>
    intents.edit(ctx.creature.id, { senses: sensesEdit(senses, patch, ctx.client) });
  const toggle = (patch: Partial<Senses>) => busy.run(() => commit(patch));
  const switchOff = !live || busy.busy;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {(["visionFt", "darkvisionFt"] as const).map((key) => (
        <span key={key} className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">
            {key === "visionFt" ? "Vision" : "Darkvision"}
          </span>
          <IntField
            path={`senses.${key}`}
            label={key === "visionFt" ? "Vision (ft)" : "Darkvision (ft)"}
            value={senses?.[key] ?? 0}
            min={0}
            max={120}
            step={5}
            commit={(v) => commit({ [key]: v ?? 0 })}
          />
          <span className="text-muted-foreground">ft</span>
        </span>
      ))}
      <SenseSwitch
        testId="charx-senses-darkness"
        label="Sees through magical darkness"
        hint={DARKNESS_HINT}
        checked={senses?.seesMagicalDarkness ?? false}
        disabled={switchOff}
        onChange={(v) => toggle({ seesMagicalDarkness: v })}
      />
      <SenseSwitch
        testId="charx-senses-invisible"
        label="Sees invisible"
        hint={invisibleHint(ctx.client)}
        checked={senses?.seesInvisible ?? false}
        disabled={switchOff}
        locked={ctx.client !== "dm"}
        onChange={(v) => toggle({ seesInvisible: v })}
      />
    </div>
  );
}

/** FR-CHARX-50: "Senses Vision 30 ft · Darkvision 60 ft · …" or "Senses —"; editors below. */
export function SensesLine() {
  const ctx = useSheet();
  const senses = ctx.stats.senses;
  return (
    <div className="flex flex-col gap-1.5">
      <p data-testid="charx-senses" className="text-xs">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Senses</span>{" "}
        <span>{sensesText(senses)}</span>
      </p>
      {ctx.editing && ctx.canEdit && <SensesEditor senses={senses} />}
    </div>
  );
}
