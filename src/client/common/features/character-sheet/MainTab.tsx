// Main tab (CHARX §7), laid out as a printed sheet (§6.2): labelled boxes (FR-CHARX-105); the
// stat row with the Armor Class shield, Hit Points, Speed, Initiative (the box is the Initiative
// button, FR-CHAR-24) and Proficiency (FR-CHARX-106); the HP control row (FR-CHARX-107); the
// vitals box (hit dice + `vitals` sections) and the Senses line (FR-CHARX-108); ability blocks
// (the modifier is the Check button, the Save line inside, FR-CHARX-109); the Skills box and the
// passive boxes (FR-CHARX-110/111); main sections. Two columns once the sheet is ≥ 560 px wide
// (FR-CHARX-112); every derived number has its breakdown Tooltip (FR-CHARX-113). No attack row
// (FR-CHARX-44). Edit mode: identity, scores, proficiencies, stats and overrides in place
// (FR-CHARX-27, -116).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { hpState, isDown, parseHpAmount, signed, speedText } from "@shared/character-sheet/logic";
import { CHAR_ADJUST_HP } from "@shared/character-sheet/schemas";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type ClassRow,
  CR_VALUES,
  checkBonus,
  HIT_DICE,
  type PassiveSkill,
  proficiencyBonus,
  SIZES,
  saveBonus,
} from "@shared/entities/schemas";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import { Badge, Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { BOX_LABEL, BOX_VALUE, Box, D20Glyph, ShieldOutline } from "./boxes";
import { BreakdownTip } from "./breakdown";
import { RoutedRoll, SheetRoll } from "./CharacterSheet";
import {
  IntField,
  OverrideControl,
  OverrideEdit,
  OverrideMark,
  SelectField,
  TextField,
  useBusy,
} from "./fields";
import { rollRoutes } from "./roll-routes";
import { type PublicOverrides, PublicSwitch, usePublicOverrides } from "./rolls";
import { rollActionView, routeFor } from "./routing";
import { SensesLine } from "./Senses";
import { SheetSlotView } from "./SheetSections";
import { sectionsFor } from "./sections";
import { useSheet, useSheetIntents } from "./sheet-context";
import { sheetSections } from "./sheet-sections";
import {
  hitDicePips,
  nextProficiency,
  passives,
  pipDelta,
  skillRows,
  withSkill,
} from "./view-model";

const HP_CLASS = { full: "text-hp-full", bloodied: "text-hp-bloodied", down: "text-hp-down" };
const HP_BAR = { full: "bg-hp-full", bloodied: "bg-hp-bloodied", down: "bg-hp-down" };

/**
 * FR-CHARX-112 / -118: the layout follows the sheet's own width (`@container/sheet` on the sheet
 * body, outside the tab content's scrollbar, so a scrollbar never flips it): wide at ≥ 560 px;
 * the ability grid keeps cells ≥ 80 px (3 columns from 268 px, 2 below, e.g. a 280 px window).
 */
export const STAT_GRID =
  "grid grid-cols-[64px_repeat(3,minmax(0,1fr))] gap-1.5 @min-[560px]/sheet:grid-cols-[96px_minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]";
export const COLUMNS =
  "flex flex-col gap-3 @min-[560px]/sheet:grid @min-[560px]/sheet:grid-cols-[200px_minmax(0,1fr)] @min-[560px]/sheet:items-start";
export const ABILITY_GRID =
  "grid grid-cols-2 gap-1.5 @min-[268px]/sheet:grid-cols-3 @min-[560px]/sheet:grid-cols-1";

/** FR-CHARX-111: the passive boxes' narrow labels; the full name is in the Tooltip. */
const PASSIVE_SHORT: Readonly<Record<PassiveSkill, string>> = {
  perception: "Perc.",
  investigation: "Invest.",
  insight: "Insight",
};

/** `char.edit` of one key; returns the intent promise (fields handle failure). */
function useEdit() {
  const ctx = useSheet();
  const intents = useSheetIntents();
  return (key: string, value: unknown) => intents.edit(ctx.creature.id, { [key]: value });
}

/** FR-CHARX-106: Armor Class in the shield (stored, so its breakdown is the value). */
function ArmorClass() {
  const ctx = useSheet();
  const edit = useEdit();
  const e = ctx.editing && ctx.canEdit;
  const value = (
    <span data-testid="char-sheet-ac" className={BOX_VALUE}>
      {e ? (
        <IntField
          path="ac"
          label="AC"
          value={ctx.stats.ac}
          min={0}
          max={30}
          inputClassName="w-11"
          commit={(v) => edit("ac", v)}
        />
      ) : (
        ctx.stats.ac
      )}
    </span>
  );
  return (
    <div
      data-testid="charx-box"
      data-value="ac"
      data-slot="sheet-shield"
      className="relative row-span-2 grid min-h-16 place-items-center text-border @min-[560px]/sheet:row-span-1"
    >
      <ShieldOutline className="size-full max-h-24" />
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-1.5 text-foreground">
        <span className={BOX_LABEL}>AC</span>
        {e ? value : <BreakdownTip okey="ac">{value}</BreakdownTip>}
      </div>
    </div>
  );
}

/**
 * FR-CHARX-106: Hit Points: `current / max`, the HP bar, "Down" at 0 and a read-only "Temp N"
 * while temp HP > 0 (OQ-CHARX-47; its control stays in the vitals box). NPC sheets: HP max.
 */
function HitPoints() {
  const ctx = useSheet();
  const edit = useEdit();
  const s = ctx.stats;
  const c = ctx.creature;
  const hp = c.kind === "character" ? c.hpCurrent : null;
  const temp = c.kind === "character" ? (c.tempHp ?? 0) : 0;
  const e = ctx.editing && ctx.canEdit;
  const state = hp === null ? null : hpState(hp, s.hpMax);
  return (
    <Box
      box="hp"
      label={hp === null ? "HP max" : "Hit Points"}
      className="col-span-3 justify-center @min-[560px]/sheet:col-span-1"
    >
      <span className="flex flex-wrap items-center justify-center gap-x-1.5">
        {hp !== null && state && (
          <span
            data-testid="char-sheet-hp"
            data-state={state}
            className={cn(BOX_VALUE, HP_CLASS[state])}
          >
            {hp} / {s.hpMax}
          </span>
        )}
        {e ? (
          <IntField
            path="hpMax"
            label="HP max"
            value={s.hpMax}
            min={1}
            max={999}
            commit={(v) => edit("hpMax", v)}
          />
        ) : (
          hp === null && (
            <span data-testid="char-sheet-hp" className={BOX_VALUE}>
              {s.hpMax}
            </span>
          )
        )}
        {hp !== null && isDown(hp) && (
          <Badge data-testid="char-sheet-down" className="bg-hp-down text-hp-down-foreground">
            Down
          </Badge>
        )}
        {temp > 0 && (
          <span
            data-testid="charx-hp-temp"
            data-value={temp}
            className="text-xs text-muted-foreground tabular-nums"
          >
            Temp {temp}
          </span>
        )}
      </span>
      {hp !== null && state && (
        <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full", HP_BAR[state])}
            style={{ width: `${Math.max(0, Math.min(100, (hp / s.hpMax) * 100))}%` }}
          />
        </span>
      )}
    </Box>
  );
}

function Speed() {
  const ctx = useSheet();
  const edit = useEdit();
  const e = ctx.editing && ctx.canEdit;
  return (
    <Box box="speed" label="Speed">
      <span data-testid="char-sheet-speed" className={BOX_VALUE}>
        {e ? (
          <IntField
            path="speed"
            label="Speed"
            value={ctx.stats.speed ?? null}
            min={0}
            max={200}
            optional
            inputClassName="w-full"
            commit={(v) => {
              if (v !== null && v % 5 !== 0) return Promise.reject(new Error("Multiple of 5"));
              return edit("speed", v);
            }}
          />
        ) : (
          speedText(ctx.stats.speed)
        )}
      </span>
    </Box>
  );
}

/**
 * FR-CHARX-106: the Initiative box is the Initiative button whenever FR-CHAR-24 shows it (routed
 * like the MVP sheet, FR-CHAR-16); otherwise a plain box ("Initiative set" under the value while
 * combat hides the button). Edit mode: the bonus input in the box.
 */
function Initiative({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const edit = useEdit();
  const store = useSync((s) => s.store);
  const s = ctx.stats;
  const claim = routeFor(rollRoutes, store, ctx.creature.id, "initiative");
  const value = (
    <span data-testid="char-sheet-init" className={BOX_VALUE}>
      {ctx.editing && ctx.canEdit ? (
        <IntField
          path="initBonus"
          label="Initiative bonus"
          value={s.initBonus}
          min={-10}
          max={20}
          inputClassName="w-full"
          commit={(v) => edit("initBonus", v)}
        />
      ) : (
        signed(s.initBonus)
      )}
    </span>
  );
  if (ctx.editing && ctx.canEdit) {
    return (
      <Box box="init" label="Init">
        {value}
      </Box>
    );
  }
  if (rollActionView(claim, "initiative") !== "button") {
    return (
      <Box box="init" label="Init">
        <BreakdownTip okey="init">{value}</BreakdownTip>
        <RoutedRoll kind="initiative" title="Initiative">
          Initiative
        </RoutedRoll>
      </Box>
    );
  }
  return (
    <Box box="init" className="p-0">
      <RoutedRoll
        kind="initiative"
        title="Initiative"
        breakdown="init"
        overrides={overrides}
        data-testid="char-sheet-roll-init"
        data-slot="sheet-roll"
        variant="ghost"
        aria-label={`Initiative ${signed(s.initBonus)}`}
        className="size-full min-h-12 flex-col gap-0 px-1 py-1"
      >
        <span className={BOX_LABEL}>Init</span>
        {value}
      </RoutedRoll>
    </Box>
  );
}

/** FR-CHARX-106: Proficiency in its own box (it left the Abilities header). */
function Proficiency() {
  const ctx = useSheet();
  return (
    <Box box="prof">
      <span data-testid="char-sheet-prof" className="flex flex-col items-center">
        <span className={BOX_LABEL}>Prof</span>{" "}
        <span data-testid="charx-prof" className={BOX_VALUE}>
          <OverrideControl okey="proficiency" breakdown>
            {signed(proficiencyBonus(ctx.stats))}
          </OverrideControl>
        </span>
      </span>
    </Box>
  );
}

/** FR-CHARX-106: narrow, AC tall on the left, HP across the top, the rest below; wide, one row. */
function StatRow({ overrides }: { overrides: PublicOverrides }) {
  return (
    <div className={STAT_GRID}>
      <ArmorClass />
      <HitPoints />
      <Speed />
      <Initiative overrides={overrides} />
      <Proficiency />
    </div>
  );
}

/** FR-CHAR-11: amount 1–999 + Damage / Heal; characters, owner or DM (also locked). */
function HpControl() {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const [raw, setRaw] = useState("");
  const busy = useBusy();
  if (ctx.creature.kind !== "character" || !ctx.canCount) return null;
  const amount = parseHpAmount(raw);
  const disabled = !live || busy.busy || amount === null;
  const send = (sign: 1 | -1) => {
    if (amount === null) return;
    busy.run(() =>
      intents
        .send(CHAR_ADJUST_HP, { characterId: ctx.creature.id, delta: sign * amount })
        .then(() => setRaw("")),
    );
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        data-testid="char-sheet-hp-input"
        aria-label="HP amount"
        inputMode="numeric"
        placeholder="Amount"
        className="h-8 w-20"
        value={raw}
        disabled={!live}
        aria-invalid={raw.trim() !== "" && amount === null}
        onChange={(e) => setRaw(e.target.value)}
      />
      <Button
        data-testid="char-sheet-hp-damage"
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={() => send(-1)}
      >
        Damage
      </Button>
      <Button
        data-testid="char-sheet-hp-heal"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => send(1)}
      >
        Heal
      </Button>
    </div>
  );
}

/**
 * FR-CHARX-107: the HP control stays a row under the stat row (OQ-CHARX-48); the DM's Initiative
 * public switch sits at its end (FR-CHAR-24: none while the button is hidden).
 */
function ControlRow({ overrides }: { overrides: PublicOverrides }) {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const claim = routeFor(rollRoutes, store, ctx.creature.id, "initiative");
  const showInit =
    !(ctx.editing && ctx.canEdit) && rollActionView(claim, "initiative") === "button";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 empty:hidden">
      <HpControl />
      {showInit && (
        <span className="ml-auto">
          <PublicSwitch
            category="initiative"
            label="Public"
            testId="char-sheet-public-init"
            overrides={overrides}
          />
        </span>
      )}
    </div>
  );
}

/** Hit dice pips (FR-CHARX-17): click = use, Shift+click = restore; Reset. */
function HitDice() {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  if (ctx.creature.kind !== "character") return null;
  const pips = hitDicePips(ctx.creature.statBlock, ctx.sheet);
  if (pips.length === 0) return null;
  const use = (resource: object, op: object) =>
    busy.run(() =>
      intents.send(CHARX_INTENTS.useResource, { characterId: ctx.creature.id, resource, ...op }),
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={BOX_LABEL}>Hit dice</span>
      {pips.map((p) => (
        <span key={p.die} className="flex items-center gap-1">
          <button
            type="button"
            data-testid="charx-hitdie"
            data-value={p.die}
            data-used={p.used}
            aria-label={`Hit dice ${p.die}: ${p.used} of ${p.max} used`}
            disabled={!live || busy.busy || !ctx.canCount}
            className="rounded border px-1.5 py-0.5 tabular-nums hover:bg-muted disabled:opacity-50"
            onClick={(e) => use({ hitDie: p.die }, { delta: pipDelta(e.shiftKey) })}
          >
            {p.die} {p.max - p.used}/{p.max}
          </button>
          {p.used > 0 && ctx.canCount && (
            <button
              type="button"
              data-testid="charx-resource-reset"
              data-value={`hitDie.${p.die}`}
              disabled={!live || busy.busy}
              className="text-[10px] text-muted-foreground underline"
              onClick={() => use({ hitDie: p.die }, { reset: true })}
            >
              Reset
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * FR-CHARX-108: hit dice and the `vitals` sections (temp HP, death saves, §7.1) in one box; left
 * out when the sheet has neither (FR-CHARX-116: NPC sheets).
 */
function VitalsBox() {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const c = ctx.creature;
  const dice = c.kind === "character" && hitDicePips(c.statBlock, ctx.sheet).length > 0;
  const sections = ctx.readOnly
    ? []
    : sectionsFor(sheetSections, {
        slot: "vitals",
        client: ctx.client,
        kind: c.kind,
        store,
        creatureId: c.id,
      });
  if (!dice && sections.length === 0) return null;
  return (
    <Box box="vitals" list className="gap-1.5">
      <HitDice />
      {sections.length > 0 && (
        <SheetSlotView
          slot="vitals"
          creatureId={c.id}
          client={ctx.client}
          kind={c.kind}
          className="flex flex-col gap-1.5"
        />
      )}
    </Box>
  );
}

/** Edit mode: name, species, classes (basic list), level / class, CR, size, owner. */
function IdentityEditor() {
  const ctx = useSheet();
  const edit = useEdit();
  const players = useRecords<PlayerRecord>("player");
  const c = ctx.creature;
  const s = ctx.stats;
  const isDm = ctx.client === "dm";
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <TextField
          path="name"
          label="Name"
          value={c.name}
          max={60}
          required
          commit={(v) => edit("name", v)}
        />
        {"species" in s || c.kind === "character" ? (
          <TextField
            path="species"
            label="Species"
            placeholder="Species"
            value={"species" in s ? (s.species ?? "") : ""}
            max={40}
            commit={(v) => edit("species", v === "" ? null : v)}
          />
        ) : null}
        {"cr" in s && (
          <SelectField
            path="cr"
            label="CR"
            value={s.cr}
            options={CR_VALUES.map((v) => ({ value: v, label: `CR ${v}` }))}
            commit={(v) => edit("cr", v)}
          />
        )}
        {isDm && (
          <SelectField
            path="size"
            label="Size"
            value={s.size}
            options={SIZES.map((v) => ({ value: v, label: v }))}
            commit={(v) => edit("size", v)}
          />
        )}
        {isDm && c.kind === "character" && (
          <SelectField
            path="ownerPlayerId"
            label="Owner"
            value={c.ownerPlayerId}
            options={players.map((p) => ({ value: p.id, label: p.name }))}
            commit={(v) => edit("ownerPlayerId", v)}
          />
        )}
      </div>
      {"level" in s && <ClassesEditor />}
    </div>
  );
}

/** FR-CHARX-04 basic list UI: class rows set `classes`; without rows, level + class name. */
function ClassesEditor() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const s = ctx.stats as { classes?: ClassRow[]; level: number; className: string };
  const rows = s.classes ?? [];
  const setRows = (next: ClassRow[]) => busy.run(() => edit("classes", next.length ? next : null));
  const row = (i: number, patch: Partial<ClassRow>) =>
    rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Classes</span>
      {rows.length === 0 && (
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <TextField
            path="className"
            label="Class"
            placeholder="Class"
            value={s.className}
            max={40}
            commit={(v) => edit("className", v)}
          />
          <IntField
            path="level"
            label="Level"
            value={s.level}
            min={1}
            max={20}
            commit={(v) => edit("level", v)}
          />
        </div>
      )}
      {rows.map((r, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: class rows have no id; positional.
          key={i}
          className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-1"
        >
          <TextField
            path={`classes.${i}.name`}
            label="Class name"
            value={r.name}
            max={30}
            required
            commit={(v) => edit("classes", row(i, { name: v }))}
          />
          <IntField
            path={`classes.${i}.level`}
            label="Class level"
            value={r.level}
            min={1}
            max={20}
            commit={(v) => edit("classes", row(i, { level: v ?? 1 }))}
          />
          <SelectField
            path={`classes.${i}.hitDie`}
            label="Hit die"
            value={r.hitDie}
            options={HIT_DICE.map((d) => ({ value: d, label: d }))}
            commit={(v) => edit("classes", row(i, { hitDie: v ?? "d8" }))}
          />
          <Button
            size="sm"
            variant="ghost"
            data-testid="charx-row-delete"
            data-value="classes"
            aria-label={`Remove ${r.name}`}
            disabled={!live || busy.busy}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            ×
          </Button>
        </div>
      ))}
      {rows.length < 4 && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          data-testid="charx-row-add"
          data-value="classes"
          disabled={!live || busy.busy}
          onClick={() =>
            setRows([
              ...rows,
              {
                name: rows.length === 0 && s.className ? s.className.slice(0, 30) : "Class",
                level: rows.length === 0 ? s.level : 1,
                hitDie: "d8",
              },
            ])
          }
        >
          Add class
        </Button>
      )}
    </div>
  );
}

/** A proficiency dot (saves, skills); `double` = expertise. */
function ProfDot({ on, double = false }: { on: boolean; double?: boolean }) {
  return (
    <span data-slot="sheet-pip" className="flex gap-px">
      <span
        className={cn(
          "size-1.5 rounded-full border border-foreground/60",
          on ? "bg-foreground" : "bg-transparent",
        )}
      />
      {double && <span className="size-1.5 rounded-full bg-foreground" />}
    </span>
  );
}

/**
 * FR-CHARX-109 (FR-CHAR-22's behaviour): name; the large signed modifier is the Check button; the
 * score in a pill; the Save line (proficiency dot, "Save", the save as the Save button).
 */
function AbilityBlock({ a, overrides }: { a: Ability; overrides: PublicOverrides }) {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const s = ctx.stats;
  const e = ctx.editing && ctx.canEdit;
  const scores = s.abilities;
  if (!scores) return null;
  const profs = s.saveProficiencies ?? [];
  const check = checkBonus(s, a) as number;
  const save = saveBonus(s, a) as number;
  const proficient = profs.includes(a);
  const toggleSave = () => {
    const next = proficient ? profs.filter((x) => x !== a) : [...profs, a];
    busy.run(() => edit("saveProficiencies", next.length ? next : null));
  };
  return (
    <div
      data-testid="char-sheet-ability"
      data-value={a}
      data-slot="sheet-ability"
      className="flex min-w-0 flex-col items-center gap-0.5 rounded-md border bg-card px-1 pt-1 pb-1.5 text-center"
    >
      <span className={BOX_LABEL}>
        <span className="@min-[560px]/sheet:hidden">{a.toUpperCase()}</span>
        <span className="hidden @min-[560px]/sheet:inline">{ABILITY_NAMES[a]}</span>
      </span>
      <span className="flex items-center gap-0.5">
        <SheetRoll
          kind="check"
          rollRef={{ ability: a }}
          title={`${ABILITY_NAMES[a]} check`}
          breakdown={`check.${a}`}
          overrides={overrides}
          data-testid="char-sheet-roll-check"
          data-value={a}
          data-slot="sheet-roll"
          variant="ghost"
          className="h-8 px-1.5 text-xl font-semibold tabular-nums"
          aria-label={`${ABILITY_NAMES[a]} check ${signed(check)}`}
        >
          <OverrideMark okey={`check.${a}`}>
            <span data-testid="char-sheet-ability-mod" data-value={a}>
              {signed(check)}
            </span>
          </OverrideMark>
        </SheetRoll>
        <OverrideEdit okey={`check.${a}`} />
      </span>
      {e ? (
        <IntField
          path={`abilities.${a}`}
          label={ABILITY_NAMES[a]}
          value={scores[a]}
          min={1}
          max={30}
          inputClassName="w-10"
          commit={(v) => edit("abilities", { ...scores, [a]: v })}
        />
      ) : (
        <span
          data-testid="char-sheet-ability-score"
          data-value={a}
          className="rounded-full border px-2 text-xs text-muted-foreground tabular-nums"
        >
          {scores[a]}
        </span>
      )}
      <span className="flex flex-wrap items-center justify-center gap-1 text-[10px] text-muted-foreground">
        {e && (
          <Checkbox
            data-testid="charx-field"
            data-value={`saveProficiencies.${a}`}
            aria-label={`${ABILITY_NAMES[a]} save proficiency`}
            checked={proficient}
            disabled={!live || busy.busy}
            onCheckedChange={toggleSave}
          />
        )}
        <span
          data-testid="char-sheet-save-prof"
          data-value={a}
          data-proficient={proficient ? "true" : "false"}
        >
          <ProfDot on={proficient} />
        </span>
        Save
        <SheetRoll
          kind="save"
          rollRef={{ ability: a }}
          title={`${ABILITY_NAMES[a]} save`}
          breakdown={`save.${a}`}
          overrides={overrides}
          data-testid="char-sheet-roll-save"
          data-value={a}
          data-slot="sheet-roll"
          className="h-6 px-1.5 text-xs tabular-nums"
          aria-label={`${ABILITY_NAMES[a]} save ${signed(save)}`}
        >
          <OverrideMark okey={`save.${a}`}>{signed(save)}</OverrideMark>
        </SheetRoll>
        <OverrideEdit okey={`save.${a}`} />
      </span>
    </div>
  );
}

/** FR-CHAR-22 / FR-CHARX-109: the six ability blocks; the DM's public switches above them. */
function AbilitiesBlock() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const overrides = usePublicOverrides();
  const busy = useBusy();
  const e = ctx.editing && ctx.canEdit;
  if (!ctx.stats.abilities) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p data-testid="char-sheet-abilities-empty" className="text-sm text-muted-foreground">
          No ability scores
        </p>
        {e && (
          <Button
            size="sm"
            variant="outline"
            data-testid="charx-field"
            data-value="abilities"
            disabled={!live || busy.busy}
            onClick={() =>
              busy.run(() =>
                edit("abilities", { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
              )
            }
          >
            Add scores
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {ctx.client === "dm" && !ctx.npc && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PublicSwitch
            category="ability-check"
            label="Checks"
            testId="char-sheet-public-check"
            overrides={overrides}
          />
          <PublicSwitch
            category="saving-throw"
            label="Saves"
            testId="char-sheet-public-save"
            overrides={overrides}
          />
        </div>
      )}
      <div className={ABILITY_GRID}>
        {ABILITIES.map((a) => (
          <AbilityBlock key={a} a={a} overrides={overrides} />
        ))}
      </div>
    </div>
  );
}

/**
 * FR-CHARX-110 / -111: the Skills box (18 rows, alphabetical: dot / double dot, name, ability
 * tag, bonus = roll button with a d20 glyph; proficient rows tinted), then the passive boxes.
 */
function SkillsBlock() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const overrides = usePublicOverrides();
  const busy = useBusy();
  const rows = skillRows(ctx.stats);
  if (!rows) return null;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Box
        box="skills"
        list
        label="Skills"
        aside={
          <PublicSwitch
            category="skill-check"
            label="Public"
            testId="charx-public-skill"
            overrides={overrides}
          />
        }
      >
        <div className="flex flex-col">
          {rows.map((r) => (
            <div
              key={r.skill}
              data-testid="charx-skill"
              data-value={r.skill}
              data-proficiency={r.proficiency ?? "none"}
              data-slot="sheet-skill-row"
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-0.5 text-xs",
                r.proficiency && "bg-muted/60",
              )}
            >
              <button
                type="button"
                data-testid="charx-field"
                data-value={`skills.${r.skill}`}
                aria-label={`${r.name} proficiency: ${r.proficiency ?? "none"}`}
                disabled={!e || !live || busy.busy}
                className="flex w-4 shrink-0 justify-center disabled:cursor-default"
                onClick={() =>
                  busy.run(() => {
                    const next = withSkill(
                      ctx.stats.skills,
                      r.skill,
                      nextProficiency(r.proficiency),
                    );
                    return edit("skills", Object.keys(next).length ? next : null);
                  })
                }
              >
                <ProfDot on={r.proficiency !== null} double={r.proficiency === "expertise"} />
              </button>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="w-7 shrink-0 text-[10px] text-muted-foreground">{r.abbr}</span>
              <SheetRoll
                kind="skill"
                rollRef={{ skill: r.skill }}
                title={`${r.name} check`}
                breakdown={`skill.${r.skill}`}
                overrides={overrides}
                data-testid="charx-roll-skill"
                data-value={r.skill}
                data-slot="sheet-roll"
                className="h-5 min-w-12 justify-between gap-1 px-1.5 text-xs"
                aria-label={`${r.name} ${signed(r.bonus)}`}
              >
                <D20Glyph className="text-muted-foreground" />
                <OverrideMark okey={`skill.${r.skill}`}>
                  <span
                    data-testid="charx-skill-bonus"
                    data-value={r.skill}
                    className="tabular-nums"
                  >
                    {signed(r.bonus)}
                  </span>
                </OverrideMark>
              </SheetRoll>
              <OverrideEdit okey={`skill.${r.skill}`} />
            </div>
          ))}
        </div>
      </Box>
      <div data-testid="charx-box" data-value="passives" className="grid grid-cols-3 gap-1.5">
        {passives(ctx.stats).map((p) => (
          <div
            key={p.skill}
            data-slot="sheet-box"
            className="flex min-w-0 flex-col items-center rounded-md border bg-card px-1 pt-1 pb-1.5 text-center"
          >
            <span className={cn(BOX_LABEL, "max-w-full truncate")}>
              <span className="@min-[560px]/sheet:hidden">{PASSIVE_SHORT[p.skill]}</span>
              <span className="hidden @min-[560px]/sheet:inline">{p.name}</span>
            </span>
            <span className={BOX_VALUE}>
              <OverrideControl okey={`passive.${p.skill}`} breakdown>
                <span data-testid="charx-passive" data-value={p.skill} className="tabular-nums">
                  {p.value}
                </span>
              </OverrideControl>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** FR-CHARX-112: abilities left (≈ 200 px), Skills + passives right, once the sheet is wide. */
function Columns({ children }: { children: ReactNode }) {
  return <div className={COLUMNS}>{children}</div>;
}

export function MainTab() {
  const ctx = useSheet();
  // Initiative's DM public override: the switch (control row) and the button (stat row).
  const initOverrides = usePublicOverrides();
  const kind = ctx.creature.kind;
  return (
    <div className="flex flex-col gap-3">
      {ctx.editing && ctx.canEdit && <IdentityEditor />}
      <StatRow overrides={initOverrides} />
      <ControlRow overrides={initOverrides} />
      <VitalsBox />
      <SensesLine />
      <Columns>
        <AbilitiesBlock />
        <SkillsBlock />
      </Columns>
      {!ctx.readOnly && (
        <SheetSlotView slot="main" creatureId={ctx.creature.id} client={ctx.client} kind={kind} />
      )}
    </div>
  );
}
