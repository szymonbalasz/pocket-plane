// The map effect picker (FR-VFX-05, -10): **Map effect** None + every catalogue preset by label,
// then the preset's params (Spirit Guardians: Radiant / Necrotic, radius; Shadow of Moil: radius).
// `FxFields` is controlled (the effect dialog's draft); `RowFxPicker` commits each change with the
// spell row (`char.putRow`). Test IDs `vfx-row-fx` (`data-record-id` = the row or effect id),
// `vfx-row-fx-variant`, `vfx-row-fx-radius`.
import type { SpellRow } from "@shared/character-sheet/sheet";
import {
  type FxParamsOut,
  type FxPreset,
  fxPresets,
  presetOf,
  SPIRIT_GUARDIANS_VARIANTS,
  suggestPreset,
} from "@shared/spell-fx/presets";
import { useState } from "react";
import { toast } from "sonner";
import { useSync } from "../../sync/store";
import { SELECT } from "../character-sheet/fields";
import { intentErrorText } from "../character-sheet/routing";

export interface FxDraft {
  preset: string;
  params: FxParamsOut;
}

interface ParamField {
  key: string;
  testId: string;
  label: string;
  options: readonly { value: string | number; label: string }[];
}

const feet = (min: number, max: number) =>
  Array.from({ length: (max - min) / 5 + 1 }, (_, i) => {
    const v = min + i * 5;
    return { value: v, label: `${v} ft` };
  });

/** Each preset's params as selects (a new preset adds its row; none → no params shown). */
const PARAM_FIELDS: Record<string, readonly ParamField[]> = {
  "spirit-guardians": [
    {
      key: "variant",
      testId: "vfx-row-fx-variant",
      label: "Spirit Guardians look",
      options: SPIRIT_GUARDIANS_VARIANTS.map((v) => ({
        value: v,
        label: v === "radiant" ? "Radiant" : "Necrotic",
      })),
    },
    { key: "radiusFt", testId: "vfx-row-fx-radius", label: "Radius", options: feet(5, 60) },
  ],
  "shadow-of-moil": [
    { key: "radiusFt", testId: "vfx-row-fx-radius", label: "Radius", options: feet(5, 30) },
  ],
};

/** FR-VFX-04 / -05: a preset's map effect with its default params. */
export function defaultFx(p: FxPreset): FxDraft {
  return { preset: p.key, params: p.params.parse({}) };
}

/** FR-VFX-05: the pre-pick for a new name on a row with no `fx` yet (null: none). */
export function suggestedFx(name: string): FxDraft | null {
  const p = suggestPreset(name);
  return p ? defaultFx(p) : null;
}

const NONE = "";

export function FxFields({
  recordId,
  value,
  disabled,
  onChange,
}: {
  recordId: string | undefined;
  value: FxDraft | null;
  disabled?: boolean;
  onChange(v: FxDraft | null): void;
}) {
  const preset = value ? presetOf(value.preset) : null;
  const fields = value ? (PARAM_FIELDS[value.preset] ?? []) : [];
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        data-testid="vfx-row-fx"
        data-record-id={recordId}
        data-value={value?.preset ?? "none"}
        aria-label="Map effect"
        className={SELECT}
        disabled={disabled}
        value={value?.preset ?? NONE}
        onChange={(e) => {
          const p = presetOf(e.target.value);
          onChange(p ? defaultFx(p) : null);
        }}
      >
        <option value={NONE}>Map effect: none</option>
        {fxPresets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        {value && !preset && <option value={value.preset}>{value.preset}</option>}
      </select>
      {value &&
        preset &&
        fields.map((f) => (
          <select
            key={f.key}
            data-testid={f.testId}
            data-record-id={recordId}
            aria-label={f.label}
            className={SELECT}
            disabled={disabled}
            value={String(value.params[f.key] ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              const v = typeof f.options[0]?.value === "number" ? Number(raw) : raw;
              const r = preset.params.safeParse({ ...value.params, [f.key]: v });
              if (r.success) onChange({ preset: value.preset, params: r.data });
            }}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
    </div>
  );
}

/** FR-VFX-05: the spell row editor's Map effect, saved with the row on each change. */
export function RowFxPicker({
  row,
  put,
}: {
  row: SpellRow;
  put(patch: Partial<SpellRow>): Promise<unknown>;
}) {
  const live = useSync((s) => s.state === "live");
  const [busy, setBusy] = useState(false);
  const value = row.fx ? { preset: row.fx.preset, params: row.fx.params } : null;
  return (
    <FxFields
      recordId={row.id}
      value={value}
      disabled={!live || busy}
      onChange={(v) => {
        setBusy(true);
        put({ fx: v ?? undefined })
          .catch((err) => toast.error(intentErrorText(err)))
          .finally(() => setBusy(false));
      }}
    />
  );
}
