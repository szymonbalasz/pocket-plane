// Actions tab (CHARX §7): attacks (Attack · Damage · Attack + damage each, §6.1), spellcasting
// header (spell attack, DC, slot pips), spells grouped by level with their rolls. The only place
// attacks are rolled (FR-CHARX-44). Edit mode: rows editable in place.
import { signed } from "@shared/character-sheet/logic";
import { CHARX_INTENTS, ROW_LIMITS, type SpellRow } from "@shared/character-sheet/sheet";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Attack,
  DAMAGE_RE,
  DAMAGE_TYPES,
  SPELL_LEVELS,
  spellAttackBonus,
  spellSaveDc,
} from "@shared/entities/schemas";
import { useSync } from "../../sync/store";
import { SheetRoll } from "./CharacterSheet";
import { IntField, OverrideControl, SelectField, SheetField, TextField, useBusy } from "./fields";
import { type PublicOverrides, PublicSwitch, usePublicOverrides } from "./rolls";
import { AddRow, RowTools, useRows } from "./rows";
import { useSheet, useSheetIntents } from "./sheet-context";
import {
  attackButtons,
  pipDelta,
  type RowRollButton,
  slotPips,
  spellButtons,
  spellGroups,
  spellLevelLabel,
} from "./view-model";

const damageText = (damage: string, type?: string) => (type ? `${damage} ${type}` : damage);

function DamageField({
  path,
  value,
  optional,
  commit,
}: {
  path: string;
  value: string | undefined;
  optional?: boolean;
  commit(v: string | undefined): Promise<unknown>;
}) {
  return (
    <SheetField<string | undefined>
      path={path}
      label="Damage"
      placeholder="1d6+2"
      value={value}
      inputClassName="w-20"
      format={(v) => v ?? ""}
      parse={(t) => {
        const v = t.trim();
        if (v === "") return optional ? { value: undefined } : { error: "Required" };
        return DAMAGE_RE.test(v) ? { value: v } : { error: "Like 1d6+2" };
      }}
      commit={commit}
    />
  );
}

const typeOptions = [
  { value: "" as const, label: "—" },
  ...DAMAGE_TYPES.map((t) => ({ value: t, label: t })),
];

/**
 * FR-CHARX-41/43: a row's roll buttons in §6.1 order; each asks the roll routes with its own
 * kind + the row's ref (a hidden claim drops that button only). DM public overrides are the
 * Attacks block's switches (`charx-public-attack` / `-damage`, by the roll's category).
 */
function RowButtons({
  buttons,
  name,
  rollRef,
  rowId,
  overrides,
}: {
  buttons: RowRollButton[];
  name: string;
  rollRef: { attackId?: string; spellId?: string };
  rowId: string | undefined;
  overrides: PublicOverrides;
}) {
  return (
    <div className="flex justify-end gap-1.5">
      {buttons.map((b) => (
        <SheetRoll
          key={b.kind}
          kind={b.kind}
          rollRef={rollRef}
          title={`${name} ${b.label.toLowerCase()}`}
          overrides={overrides}
          data-testid={b.testId}
          data-record-id={rowId}
        >
          {b.label}
        </SheetRoll>
      ))}
    </div>
  );
}

function AttackRow({
  a,
  index,
  count,
  overrides,
}: {
  a: Attack;
  index: number;
  count: number;
  overrides: PublicOverrides;
}) {
  const ctx = useSheet();
  const rows = useRows("attacks");
  const e = ctx.editing && ctx.canEdit;
  const put = (patch: Partial<Attack>) => {
    const next: Record<string, unknown> = { ...a, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return rows.put(next);
  };
  const ref = a.id ? { attackId: a.id } : {};
  return (
    <div
      data-testid="charx-attack"
      data-record-id={a.id}
      className="flex flex-col gap-1 border-b py-1.5"
    >
      {e ? (
        <div className="flex flex-wrap items-start gap-1">
          <TextField
            path={`attacks.${a.id}.name`}
            label="Attack name"
            value={a.name}
            max={40}
            required
            className="flex-1"
            commit={(name) => put({ name })}
          />
          <IntField
            path={`attacks.${a.id}.toHit`}
            label="To hit"
            value={a.toHit}
            min={-10}
            max={30}
            commit={(toHit) => put({ toHit: toHit ?? 0 })}
          />
          <DamageField
            path={`attacks.${a.id}.damage`}
            value={a.damage}
            commit={(damage) => put({ damage })}
          />
          <SelectField
            path={`attacks.${a.id}.damageType`}
            label="Damage type"
            value={a.damageType ?? null}
            options={typeOptions}
            commit={(t) => put({ damageType: t ?? undefined })}
          />
          <RowTools list="attacks" rowId={a.id} index={index} count={count} />
        </div>
      ) : (
        <span className="text-sm">
          {a.name}{" "}
          <span className="text-muted-foreground">
            {signed(a.toHit)} · {damageText(a.damage, a.damageType)}
          </span>
        </span>
      )}
      <RowButtons
        buttons={attackButtons()}
        name={a.name}
        rollRef={ref}
        rowId={a.id}
        overrides={overrides}
      />
    </div>
  );
}

function AttacksBlock({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const attacks = ctx.stats.attacks;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Attacks</span>
        <span className="flex items-center gap-2">
          <PublicSwitch
            category="attack"
            label="Attack"
            testId="charx-public-attack"
            overrides={overrides}
          />
          <PublicSwitch
            category="damage"
            label="Damage"
            testId="charx-public-damage"
            overrides={overrides}
          />
        </span>
      </div>
      {attacks.length === 0 && !e && <p className="text-xs text-muted-foreground">No attacks</p>}
      {attacks.map((a, i) => (
        <AttackRow
          key={a.id ?? `legacy-${i}`}
          a={a}
          index={i}
          count={attacks.length}
          overrides={overrides}
        />
      ))}
      {e && (
        <AddRow
          list="attacks"
          label="Attack"
          full={attacks.length >= ROW_LIMITS.attacks}
          row={{ name: "New attack", toHit: 0, damage: "1d6" }}
        />
      )}
    </div>
  );
}

function SlotPips() {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const pips = slotPips(ctx.stats, ctx.sheet);
  const counters = ctx.creature.kind === "character" && ctx.canCount;
  const use = (level: string, op: object) =>
    busy.run(() =>
      intents.send(CHARX_INTENTS.useResource, {
        characterId: ctx.creature.id,
        resource: { slot: Number(level) },
        ...op,
      }),
    );
  if (pips.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {pips.map((p) => (
        <div key={p.level} className="flex items-center gap-1.5 text-xs">
          <span className="w-12 text-muted-foreground">Level {p.level}</span>
          <span className="flex gap-0.5">
            {Array.from({ length: p.max }, (_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional.
                key={i}
                type="button"
                data-testid="charx-slot"
                data-value={p.level}
                data-used={p.used}
                aria-label={`Level ${p.level} slots: ${p.used} of ${p.max} used`}
                disabled={!live || busy.busy || !counters}
                className={`size-3 rounded-full border border-foreground/60 ${i < p.used ? "bg-foreground" : ""}`}
                onClick={(e) => use(p.level, { delta: pipDelta(e.shiftKey) })}
              />
            ))}
          </span>
          {counters && p.used > 0 && (
            <button
              type="button"
              data-testid="charx-resource-reset"
              data-value={`slot.${p.level}`}
              disabled={!live || busy.busy}
              className="text-[10px] text-muted-foreground underline"
              onClick={() => use(p.level, { reset: true })}
            >
              Reset
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Edit mode: spellcasting ability + slot maxima (FR-CHARX-01). */
function SpellcastingEditor() {
  const ctx = useSheet();
  const intents = useSheetIntents();
  const sc = ctx.stats.spellcasting;
  const edit = (v: unknown) => intents.edit(ctx.creature.id, { spellcasting: v });
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        path="spellcasting.ability"
        label="Spellcasting ability"
        value={sc?.ability ?? null}
        options={[
          { value: "" as const, label: "No spellcasting" },
          ...ABILITIES.map((a) => ({ value: a, label: ABILITY_NAMES[a] })),
        ]}
        commit={(ability) => edit(ability ? { ability, slots: sc?.slots ?? {} } : null)}
      />
      {sc && (
        <div className="grid grid-cols-5 gap-1">
          {SPELL_LEVELS.map((l) => (
            <IntField
              key={l}
              path={`spellcasting.slots.${l}`}
              label={`Level ${l} slots`}
              value={sc.slots[l] ?? 0}
              min={0}
              max={9}
              inputClassName="w-full"
              commit={(n) => {
                const slots = { ...sc.slots };
                if (n) slots[l] = n;
                else delete slots[l];
                return edit({ ...sc, slots });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpellcastingHeader() {
  const ctx = useSheet();
  const e = ctx.editing && ctx.canEdit;
  const atk = spellAttackBonus(ctx.stats);
  const dc = spellSaveDc(ctx.stats);
  if (!ctx.stats.spellcasting && !e) return null;
  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <span className="text-xs font-medium text-muted-foreground">Spellcasting</span>
      {e && <SpellcastingEditor />}
      {atk !== null && dc !== null && (
        <span data-testid="charx-spellcasting" className="text-xs">
          {ABILITY_NAMES[ctx.stats.spellcasting?.ability ?? "wis"]} · Spell attack{" "}
          <OverrideControl okey="spellAttack">{signed(atk)}</OverrideControl> · DC{" "}
          <OverrideControl okey="spellDc">{dc}</OverrideControl>
        </span>
      )}
      <SlotPips />
    </div>
  );
}

const marks = (s: SpellRow) =>
  [s.concentration ? "C" : null, s.ritual ? "R" : null, s.prepared ? "P" : null]
    .filter(Boolean)
    .join(" ");

function SpellEditor({ s, index, count }: { s: SpellRow; index: number; count: number }) {
  const rows = useRows("spells");
  const put = (patch: Partial<SpellRow>) => {
    const next: Record<string, unknown> = { ...s, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (next.roll !== "save") delete next.saveAbility;
    if (next.roll === "attack") next.effect = "damage";
    return rows.put(next);
  };
  const flag = (k: "prepared" | "concentration" | "ritual", label: string) => (
    <SelectField
      path={`spells.${s.id}.${k}`}
      label={label}
      value={s[k] ? "yes" : "no"}
      options={[
        { value: "no", label: `${label}: no` },
        { value: "yes", label: `${label}: yes` },
      ]}
      commit={(v) => put({ [k]: v === "yes" })}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-1">
        <TextField
          path={`spells.${s.id}.name`}
          label="Spell name"
          value={s.name}
          max={60}
          required
          className="flex-1"
          commit={(name) => put({ name })}
        />
        <IntField
          path={`spells.${s.id}.level`}
          label="Spell level"
          value={s.level}
          min={0}
          max={9}
          commit={(level) => put({ level: level ?? 0 })}
        />
        <RowTools list="spells" rowId={s.id} index={index} count={count} />
      </div>
      <div className="flex flex-wrap items-start gap-1">
        <SelectField
          path={`spells.${s.id}.roll`}
          label="Roll"
          value={s.roll}
          options={[
            { value: "none", label: "No roll" },
            { value: "attack", label: "Attack" },
            { value: "save", label: "Save" },
          ]}
          commit={(roll) =>
            put({
              roll: roll ?? "none",
              saveAbility: roll === "save" ? (s.saveAbility ?? "dex") : undefined,
            })
          }
        />
        {s.roll === "save" && (
          <SelectField
            path={`spells.${s.id}.saveAbility`}
            label="Save ability"
            value={s.saveAbility ?? "dex"}
            options={ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }))}
            commit={(saveAbility) => put({ saveAbility: saveAbility ?? "dex" })}
          />
        )}
        <DamageField
          path={`spells.${s.id}.damage`}
          value={s.damage}
          optional
          commit={(damage) => put({ damage })}
        />
        <SelectField
          path={`spells.${s.id}.effect`}
          label="Effect"
          value={s.effect}
          options={[
            { value: "damage", label: "Damage" },
            { value: "healing", label: "Healing" },
          ]}
          commit={(effect) => put({ effect: effect ?? "damage" })}
        />
        <SelectField
          path={`spells.${s.id}.damageType`}
          label="Damage type"
          value={s.damageType ?? null}
          options={typeOptions}
          commit={(t) => put({ damageType: t ?? undefined })}
        />
        {flag("prepared", "Prepared")}
        {flag("concentration", "Conc.")}
        {flag("ritual", "Ritual")}
      </div>
      <TextField
        path={`spells.${s.id}.notes`}
        label="Spell notes"
        placeholder="Notes"
        value={s.notes}
        max={200}
        commit={(notes) => put({ notes })}
      />
    </div>
  );
}

function SpellRowView({
  s,
  index,
  count,
  overrides,
}: {
  s: SpellRow;
  index: number;
  count: number;
  overrides: PublicOverrides;
}) {
  const ctx = useSheet();
  const e = ctx.editing && ctx.canEdit;
  return (
    <div
      data-testid="charx-spell"
      data-record-id={s.id}
      className="flex flex-col gap-1 border-b py-1.5"
    >
      {e ? (
        <SpellEditor s={s} index={index} count={count} />
      ) : (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{s.name}</span>
          <span className="text-[10px] text-muted-foreground">{marks(s)}</span>
        </div>
      )}
      {!e && s.notes && (
        <p className="text-xs whitespace-pre-wrap text-muted-foreground">{s.notes}</p>
      )}
      <RowButtons
        buttons={spellButtons(s)}
        name={s.name}
        rollRef={{ spellId: s.id }}
        rowId={s.id}
        overrides={overrides}
      />
    </div>
  );
}

function SpellsBlock({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const spells = ctx.sheet.spells;
  const e = ctx.editing && ctx.canEdit;
  if (spells.length === 0 && !e) return null;
  return (
    <div className="flex flex-col gap-1 border-t pt-2">
      <span className="text-xs font-medium text-muted-foreground">Spells</span>
      {spellGroups(spells).map((g) => (
        <div key={g.level} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {spellLevelLabel(g.level)}
          </span>
          {g.spells.map((s) => (
            <SpellRowView
              key={s.id}
              s={s}
              index={spells.indexOf(s)}
              count={spells.length}
              overrides={overrides}
            />
          ))}
        </div>
      ))}
      {e && (
        <AddRow
          list="spells"
          label="Spell"
          full={spells.length >= ROW_LIMITS.spells}
          row={{ name: "New spell", level: 1 }}
        />
      )}
    </div>
  );
}

export function ActionsTab() {
  // One set of DM public overrides for the tab: the Attacks block's switches apply to every
  // attack / damage roll on it (FR-CHAR-22's rule; §6.1 "Public").
  const overrides = usePublicOverrides();
  return (
    <div className="flex flex-col gap-2">
      <AttacksBlock overrides={overrides} />
      <SpellcastingHeader />
      <SpellsBlock overrides={overrides} />
    </div>
  );
}
