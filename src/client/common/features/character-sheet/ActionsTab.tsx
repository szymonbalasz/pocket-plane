// Actions tab (CHARX §7): attacks (Attack · Damage each, §6.1, FR-CHARX-126), spellcasting
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
  type ExtraDamage,
  SPELL_LEVELS,
  spellAttackBonus,
  spellSaveDc,
} from "@shared/entities/schemas";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Badge, Input } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { DiceText } from "../dice-extras/DiceText";
import { RowFxPicker, suggestedFx } from "../spell-fx/FxPicker";
import { BOX_LABEL, Box } from "./boxes";
import { SheetRoll } from "./CharacterSheet";
import {
  IntField,
  OverrideControl,
  SELECT,
  SelectField,
  SheetField,
  TextField,
  useBusy,
} from "./fields";
import { LimitedUsesBox } from "./MoreTabs";
import { type PublicOverrides, useSheetOverrides } from "./rolls";
import { AddRow, RowTools, useRowPut } from "./rows";
import {
  notationContext,
  SheetContext,
  SheetScope,
  useSheet,
  useSheetIntents,
  useSheetScope,
} from "./sheet-context";
import { spellRowActions } from "./spell-row-actions";
import {
  attackButtons,
  attackRowView,
  canAddExtraPart,
  type ExtraPartDraft,
  extraPart,
  levelOrdinal,
  MAGIC_OPTIONS,
  pipDelta,
  type RowRollButton,
  slotPips,
  spellButtons,
  spellGroups,
  spellLevelLabel,
} from "./view-model";

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
 * FR-CHARX-126/43: a row's roll buttons in §6.1 order (a click stages the tray, FR-CHARX-127);
 * each asks the roll routes with its own kind + the row's ref (a hidden claim drops that button
 * only). DM public overrides are the header's Public rolls menu's Attack / Damage switches
 * (`charx-public-attack` / `-damage`, by the roll's category; BL-139).
 */
function RowButtons({
  buttons,
  name,
  rollRef,
  rowId,
  overrides,
  children,
}: {
  buttons: RowRollButton[];
  name: string;
  rollRef: { attackId?: string; spellId?: string };
  rowId: string | undefined;
  overrides: PublicOverrides;
  /** After the roll buttons: the spell-row actions (OQ-VFX-06 A). */
  children?: ReactNode;
}) {
  const scope = useSheetScope();
  // K13: on the wide Main, the kit's row (`.arow-btns`): small stone buttons, left under the line.
  const kit = scope === "main";
  return (
    <div className={kit ? "mt-[5px] flex flex-wrap gap-[5px]" : "flex justify-end gap-1.5"}>
      {buttons.map((b) => (
        <SheetRoll
          key={b.kind}
          kind={b.kind}
          rollRef={rollRef}
          title={`${name} ${b.label.toLowerCase()}`}
          overrides={overrides}
          data-testid={b.testId}
          data-record-id={rowId}
          data-scope={scope}
          {...(kit && { variant: "outline" as const, className: KIT_BUTTON })}
        >
          {b.label}
        </SheetRoll>
      ))}
      {children}
    </div>
  );
}

type PutAttack = (patch: Partial<Attack>) => Promise<unknown>;

/** K13: the kit's small stone button (`.btn.sm`: 24 px, 9-px sides, 13-px type). */
const KIT_BUTTON = "h-6 px-[9px] text-[13px]";
/** K13: the kit's action row (`.arow`): 7-px rows, no rule under the last. */
const KIT_ROW = "flex flex-col border-b py-[7px] last:border-b-0";

/** FR-CHARX-56: the Magic Select (none, +1 … +3); `data-value` = the stored bonus. */
function MagicSelect({ a, put }: { a: Attack; put: PutAttack }) {
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const bonus = a.bonus ?? 0;
  return (
    <select
      data-testid="charx-attack-bonus"
      data-value={bonus}
      aria-label="Magic"
      className={SELECT}
      value={bonus}
      disabled={!live || busy.busy || a.id === undefined}
      onChange={(e) => {
        const n = Number(e.target.value);
        busy.run(() => put({ bonus: n > 0 ? n : undefined }));
      }}
    >
      {MAGIC_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * FR-CHARX-56: one extra part in edit mode (`charx-attack-extra`, `data-value` = index): dice
 * Input + type Select + delete. A new part (`part` null) stays local until both are valid (the
 * FR-CHARX-54 mirror: inline "7d6" / no-type errors, nothing sent).
 */
function ExtraPartRow({
  a,
  index,
  part,
  parts,
  commit,
  onDone,
}: {
  a: Attack;
  index: number;
  part: ExtraDamage | null;
  parts: readonly ExtraDamage[];
  commit(next: ExtraDamage[]): Promise<unknown>;
  onDone?: () => void;
}) {
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const [draft, setDraft] = useState<ExtraPartDraft>({ damage: "", type: null });
  const [error, setError] = useState<string | null>(null);
  const path = `attacks.${a.id}.extraDamage.${index}.damage`;
  const tryAdd = (d: ExtraPartDraft) => {
    setDraft(d);
    if (d.damage.trim() === "") return setError(null);
    const r = extraPart(d);
    if ("error" in r) return setError(r.error);
    setError(null);
    busy.run(() => commit([...parts, r.part]).then(() => onDone?.()));
  };
  const set = (x: ExtraDamage) => parts.map((p, j) => (j === index ? x : p));
  return (
    <div
      data-testid="charx-attack-extra"
      data-value={index}
      className="flex flex-wrap items-start gap-1 pl-2"
    >
      {part ? (
        <SheetField<string>
          path={path}
          label="Extra damage"
          placeholder="2d6"
          value={part.damage}
          inputClassName="w-20"
          format={(v) => v}
          parse={(t) => {
            const r = extraPart({ damage: t, type: part.type });
            return "error" in r ? { error: r.error } : { value: r.part.damage };
          }}
          commit={(damage) => commit(set({ ...part, damage }))}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Input
            data-testid="charx-field"
            data-value={path}
            aria-label="Extra damage"
            aria-invalid={error !== null}
            placeholder="2d6"
            className="h-7 w-20 px-1.5 text-xs"
            value={draft.damage}
            disabled={!live || busy.busy}
            onChange={(e) => setDraft({ ...draft, damage: e.target.value })}
            onBlur={() => tryAdd(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") tryAdd(draft);
              if (e.key === "Escape") onDone?.();
            }}
          />
          {error && (
            <span data-testid="charx-attack-extra-error" className="text-[10px] text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
      <select
        data-testid="charx-attack-extra-type"
        data-value={index}
        aria-label="Extra damage type"
        className={SELECT}
        value={part?.type ?? draft.type ?? ""}
        disabled={!live || busy.busy}
        onChange={(e) => {
          const type = e.target.value || null;
          if (!part) return tryAdd({ ...draft, type });
          const next = extraPart({ damage: part.damage, type });
          if ("part" in next) busy.run(() => commit(set(next.part)));
        }}
      >
        {!part && <option value="">Type…</option>}
        {DAMAGE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <Tip content="Remove damage type" off={!live || busy.busy}>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="charx-attack-extra-delete"
          data-value={index}
          aria-label="Remove damage type"
          disabled={!live || busy.busy}
          onClick={() =>
            part ? busy.run(() => commit(parts.filter((_, j) => j !== index))) : onDone?.()
          }
        >
          ×
        </Button>
      </Tip>
    </div>
  );
}

/** FR-CHARX-56: the row's extra parts in edit mode + "Add damage type" (≤ 2, then disabled). */
function ExtraParts({ a, put }: { a: Attack; put: PutAttack }) {
  const live = useSync((s) => s.state === "live");
  const [adding, setAdding] = useState(false);
  const parts = a.extraDamage ?? [];
  const commit = (next: ExtraDamage[]) => put({ extraDamage: next.length > 0 ? next : undefined });
  return (
    <div className="flex flex-col gap-1">
      {parts.map((p, i) => (
        <ExtraPartRow
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional (no ids).
          key={i}
          a={a}
          index={i}
          part={p}
          parts={parts}
          commit={commit}
        />
      ))}
      {adding && (
        <ExtraPartRow
          a={a}
          index={parts.length}
          part={null}
          parts={parts}
          commit={commit}
          onDone={() => setAdding(false)}
        />
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-fit px-2 text-xs"
        data-testid="charx-attack-extra-add"
        disabled={!live || adding || !canAddExtraPart(a) || a.id === undefined}
        onClick={() => setAdding(true)}
      >
        Add damage type
      </Button>
    </div>
  );
}

/** FR-CHARX-56: view mode: name + "+1" Badge, then "+8 · 2d6+5 slashing + 2d6 fire". */
function AttackLine({ a }: { a: Attack }) {
  const v = attackRowView(a);
  const parts = v.parts.map((p, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
    <span key={i} className="whitespace-nowrap">
      {i > 0 ? " " : ""}
      {p}
    </span>
  ));
  if (useSheetScope() === "main") {
    // K13 (kit `.arow-top` / `.arow-line`): the name bold, its chip (the magic "+1") at the
    // right of the name line; the numbers line muted under it.
    return (
      <div className="flex flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 break-words text-[15px] font-bold">{v.name}</span>
          {v.badge && (
            <Badge data-testid="charx-attack-bonus" data-value={a.bonus} variant="outline">
              {v.badge}
            </Badge>
          )}
        </span>
        <span data-testid="charx-attack-numbers" className="text-sm text-muted-foreground">
          {parts}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col text-sm">
      <span className="flex items-center gap-1.5">
        {v.name}{" "}
        {v.badge && (
          <Badge data-testid="charx-attack-bonus" data-value={a.bonus} variant="secondary">
            {v.badge}
          </Badge>
        )}
      </span>
      <span data-testid="charx-attack-numbers" className="text-muted-foreground">
        {parts}
      </span>
    </div>
  );
}

/** FR-CHARX-56: a row's whole-row put (`char.putRow` with its id); unset keys dropped. */
export function useAttackPut(a: Attack): PutAttack {
  return useRowPut("attacks", a);
}

/**
 * FR-CHARX-56: one attack row in edit mode (name, to-hit, damage, type, Magic, extra parts);
 * `tools` = the row's delete / move controls. Also the companion card's (FR-CHARX-63).
 */
export function AttackEditFields({ a, tools }: { a: Attack; tools: ReactNode }) {
  const put = useAttackPut(a);
  return (
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
      <MagicSelect a={a} put={put} />
      {tools}
      <div className="basis-full">
        <ExtraParts a={a} put={put} />
      </div>
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
  const scope = useSheetScope();
  const e = ctx.editing && ctx.canEdit;
  const ref = a.id ? { attackId: a.id } : {};
  return (
    <div
      data-testid="charx-attack"
      data-record-id={a.id}
      data-scope={scope}
      className={scope === "main" ? KIT_ROW : "flex flex-col gap-1 border-b py-1.5"}
    >
      {e ? (
        <AttackEditFields
          a={a}
          tools={<RowTools list="attacks" rowId={a.id} index={index} count={count} />}
        />
      ) : (
        <AttackLine a={a} />
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
    <Box box="attacks" list label="Attacks">
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
    </Box>
  );
}

function SlotPips() {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const scope = useSheetScope();
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
  if (scope === "main")
    return <KitSlots pips={pips} counters={counters} busy={busy.busy} use={use} />;
  return (
    <div className="flex flex-col gap-0.5">
      {pips.map((p) => (
        <div key={p.level} className="flex items-center gap-1.5 text-xs">
          <span className="w-12 text-muted-foreground">Level {p.level}</span>
          <span className="flex gap-0.5">
            {Array.from({ length: p.max }, (_, i) => (
              <Tip
                // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional.
                key={i}
                content={`Level ${p.level} slots: ${p.used} of ${p.max} used`}
                off={!live || busy.busy || !counters}
              >
                <button
                  type="button"
                  data-testid="charx-slot"
                  data-scope={scope}
                  data-value={p.level}
                  data-used={p.used}
                  aria-label={`Level ${p.level} slots: ${p.used} of ${p.max} used`}
                  disabled={!live || busy.busy || !counters}
                  data-slot="sheet-pip"
                  className={`size-3 rounded-full border border-foreground/60 ${i < p.used ? "bg-foreground" : ""}`}
                  onClick={(e) => use(p.level, { delta: pipDelta(e.shiftKey) })}
                />
              </Tip>
            ))}
          </span>
          {counters && p.used > 0 && (
            <button
              type="button"
              data-testid="charx-resource-reset"
              data-scope={scope}
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

/**
 * K13 (kit `.slots`): the wide Main's slots on one wrapping line: "1st" in label size, the slots
 * as diamonds (filled = used, as the Actions tab's pips; same IDs, clicks and Reset), then
 * "used / max".
 */
function KitSlots({
  pips,
  counters,
  busy,
  use,
}: {
  pips: ReturnType<typeof slotPips>;
  counters: boolean;
  busy: boolean;
  use(level: string, op: object): void;
}) {
  const live = useSync((s) => s.state === "live");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {pips.map((p) => (
        <span key={p.level} className="flex items-center gap-1.5">
          <span className={cn(BOX_LABEL, "normal-case")}>{levelOrdinal(p.level)}</span>
          <span className="flex gap-1.5 px-0.5">
            {Array.from({ length: p.max }, (_, i) => (
              <Tip
                // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional.
                key={i}
                content={`Level ${p.level} slots: ${p.used} of ${p.max} used`}
                off={!live || busy || !counters}
              >
                <button
                  type="button"
                  data-testid="charx-slot"
                  data-scope="main"
                  data-value={p.level}
                  data-used={p.used}
                  aria-label={`Level ${p.level} slots: ${p.used} of ${p.max} used`}
                  disabled={!live || busy || !counters}
                  data-slot="sheet-pip"
                  className={cn(
                    "size-3 rounded-[1px] border border-foreground/60 [transform:rotate(45deg)]",
                    i < p.used && "bg-foreground",
                  )}
                  onClick={(e) => use(p.level, { delta: pipDelta(e.shiftKey) })}
                />
              </Tip>
            ))}
          </span>
          <span data-testid="charx-slot-count" data-value={p.level} className="tabular-nums">
            {p.used} / {p.max}
          </span>
          {counters && p.used > 0 && (
            <button
              type="button"
              data-testid="charx-resource-reset"
              data-scope="main"
              data-value={`slot.${p.level}`}
              disabled={!live || busy}
              className="text-[10px] text-muted-foreground underline"
              onClick={() => use(p.level, { reset: true })}
            >
              Reset
            </button>
          )}
        </span>
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
  // BL-141 (K6c gap 6): on the wide Main, the kit's order: the pip row, then one muted line
  // (ability · attack · DC); no "Spellcasting" label under the box's own heading.
  const kit = useSheetScope() === "main";
  if (!ctx.stats.spellcasting && !e) return null;
  const line = atk !== null && dc !== null && (
    <span
      data-testid="charx-spellcasting"
      className={kit ? "text-xs text-muted-foreground" : "text-xs"}
    >
      {ABILITY_NAMES[ctx.stats.spellcasting?.ability ?? "wis"]} · Spell attack{" "}
      <OverrideControl okey="spellAttack">{signed(atk)}</OverrideControl> · DC{" "}
      <OverrideControl okey="spellDc">{dc}</OverrideControl>
    </span>
  );
  return (
    <div className="flex flex-col gap-1">
      {!kit && <span className="text-xs font-medium text-muted-foreground">Spellcasting</span>}
      {e && <SpellcastingEditor />}
      {!kit && line}
      <SlotPips />
      {kit && line}
    </div>
  );
}

const marks = (s: SpellRow) =>
  [s.concentration ? "C" : null, s.ritual ? "R" : null, s.prepared ? "P" : null]
    .filter(Boolean)
    .join(" ");

function SpellEditor({ s, index, count }: { s: SpellRow; index: number; count: number }) {
  const put = useRowPut("spells", s, (next) => {
    if (next.roll !== "save") delete next.saveAbility;
    if (next.roll === "attack") next.effect = "damage";
  });
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
          // FR-VFX-05: a name change on a row without a map effect pre-picks one (FR-VFX-04).
          commit={(name) => put({ name, ...(!s.fx && { fx: suggestedFx(name) ?? undefined }) })}
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
        <RowFxPicker row={s} put={put} />
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
  const scope = useSheetScope();
  const e = ctx.editing && ctx.canEdit;
  return (
    <div
      data-testid="charx-spell"
      data-record-id={s.id}
      data-scope={scope}
      className={scope === "main" ? KIT_ROW : "flex flex-col gap-1 border-b py-1.5"}
    >
      {e ? (
        <SpellEditor s={s} index={index} count={count} />
      ) : (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className={cn("min-w-0 break-words", scope === "main" && "text-[15px] font-bold")}>
            {s.name}
          </span>
          <span className="text-[10px] text-muted-foreground">{marks(s)}</span>
        </div>
      )}
      {!e && s.notes && (
        <p className="text-xs whitespace-pre-wrap text-muted-foreground">
          <DiceText text={s.notes} context={notationContext(ctx, s.name)} />
        </p>
      )}
      <RowButtons
        buttons={spellButtons(s)}
        name={s.name}
        rollRef={{ spellId: s.id }}
        rowId={s.id}
        overrides={overrides}
      >
        {!e && <SpellRowActions s={s} />}
      </RowButtons>
    </div>
  );
}

/** OQ-VFX-06 A: the spell-row actions registry (e.g. spell-fx's Cast / End), in `order`. */
function SpellRowActions({ s }: { s: SpellRow }) {
  const ctx = useSheet();
  const store = useSync((st) => st.store);
  const kind = ctx.npc ? "monster" : "character";
  return [...spellRowActions]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    .filter(
      (a) =>
        (a.clients ?? ["dm", "player"]).includes(ctx.client) &&
        (a.kinds ?? ["character"]).includes(kind) &&
        (a.available?.(store, ctx.creature.id, s) ?? true),
    )
    .map((a) => (
      <a.component key={a.id} creatureId={ctx.creature.id} row={s} client={ctx.client} />
    ));
}

function SpellsBlock({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const spells = ctx.sheet.spells;
  const e = ctx.editing && ctx.canEdit;
  // BL-141 (K6c gap 6): the wide Main drops the level heading while only one level shows.
  const kit = useSheetScope() === "main";
  if (spells.length === 0 && !e) return null;
  const groups = spellGroups(spells);
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <div key={g.level} className="flex flex-col">
          {!(kit && groups.length === 1) && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {spellLevelLabel(g.level)}
            </span>
          )}
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

/** FR-CHARX-114: the Spells box: the spellcasting header and slot pips, then the spells. */
function SpellsBox({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const e = ctx.editing && ctx.canEdit;
  if (!ctx.stats.spellcasting && ctx.sheet.spells.length === 0 && !e) return null;
  return (
    <Box box="spells" list label="Spells" className="gap-2">
      <SpellcastingHeader />
      <SpellsBlock overrides={overrides} />
    </Box>
  );
}

export function ActionsTab() {
  // The sheet's DM public overrides (FR-CHAR-22's rule; §6.1 "Public"): BL-139, the header's
  // Public rolls menu's Attack / Damage switches apply to every attack / damage roll on the tab.
  const overrides = useSheetOverrides();
  return (
    <div className="flex flex-col gap-2">
      <AttacksBlock overrides={overrides} />
      <SpellsBox overrides={overrides} />
    </div>
  );
}

/**
 * K13 (DM #363, the kit's wide sheet): Main's Attacks, Spells (header and slot pips) and Limited
 * uses boxes under the passives once the sheet is wide. The Actions / Features rows and buttons
 * in view mode (rows are edited on their own tabs); the DM's Attack / Damage switches are in the
 * header's Public rolls menu (BL-139), its overrides shared; every repeated test ID carries
 * `data-scope="main"`. The Actions tab is unchanged.
 */
export function WideActionBoxes() {
  const ctx = useSheet();
  const overrides = useSheetOverrides();
  return (
    <SheetContext.Provider value={{ ...ctx, editing: false }}>
      <SheetScope.Provider value="main">
        <div
          data-testid="charx-main-actions"
          data-scope="main"
          className="flex min-w-0 flex-col gap-2.5"
        >
          <AttacksBlock overrides={overrides} />
          <SpellsBox overrides={overrides} />
          <LimitedUsesBox />
        </div>
      </SheetScope.Provider>
    </SheetContext.Provider>
  );
}
