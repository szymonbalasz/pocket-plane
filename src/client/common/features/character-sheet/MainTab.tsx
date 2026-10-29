// Main tab (CHARX §7), laid out as a printed sheet (§6.2) and sized as the kit's "Character
// sheet" section (K11): labelled boxes (FR-CHARX-105); the stat row with the Armor Class shield,
// Hit Points (current / max, the bar, the Temp column), Speed, Initiative (the box is the
// Initiative button, FR-CHAR-24) and Proficiency (FR-CHARX-106); the compact HP control row
// under it (FR-CHARX-107); the vitals line (hit dice + `vitals` sections) and the Senses line
// (FR-CHARX-108); ability blocks (the modifier is the Check button, the Save inside, FR-CHARX-109);
// the Skills box and the passive boxes (FR-CHARX-110/111); main sections. Two columns once the
// sheet is ≥ 560 px wide (FR-CHARX-112); every derived number has its breakdown Tooltip
// (FR-CHARX-113). No attack row while narrow (FR-CHARX-44); once wide, the kit's Attacks, Spells
// and Limited uses boxes across both columns under them (K13, DM #363). The DM's public switches sit in the
// header's Public rolls menu (K11, `./PublicMenu`). Edit mode: identity, scores, proficiencies, stats and
// overrides in place (FR-CHARX-27, -116).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { hpState, isDown, parseHpAmount, signed } from "@shared/character-sheet/logic";
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
  TOKEN_SHAPES,
} from "@shared/entities/schemas";
import type { ReactNode } from "react";
import { useContext, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import { Badge, Input } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { WideActionBoxes } from "./ActionsTab";
import { BOX_LABEL, BOX_UNIT, BOX_VALUE, Box, D20Glyph, ShieldOutline, WideLabel } from "./boxes";
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
import { useSheetOverrides } from "./rolls";
import { rollActionView, routeFor } from "./routing";
import { SensesLine } from "./Senses";
import { SheetSlotView } from "./SheetSections";
import { sectionsFor } from "./sections";
import { SheetWide, useSheet, useSheetIntents } from "./sheet-context";
import { sheetSections } from "./sheet-sections";
import {
  hitDicePips,
  nextProficiency,
  passives,
  pipDelta,
  skillRows,
  withSkill,
} from "./view-model";

const HP_BAR = { full: "bg-hp-full", bloodied: "bg-hp-bloodied", down: "bg-hp-down" };

/**
 * FR-CHARX-112 / -118: the layout follows the sheet's own width (`@container/sheet` on the sheet
 * body, outside the tab content's scrollbar, so a scrollbar never flips it): wide at ≥ 560 px;
 * the ability grid keeps cells ≥ 80 px (3 columns from 268 px, 2 below, e.g. a 280 px window).
 * Gaps as the kit: 6 px narrow, 8 px wide (stat row, abilities), 10 / 12 px between blocks.
 */
export const STAT_GRID =
  "grid grid-cols-[64px_repeat(3,minmax(0,1fr))] gap-1.5 @min-[560px]/sheet:grid-cols-[96px_minmax(0,1.8fr)_repeat(3,minmax(0,1fr))] @min-[560px]/sheet:gap-2";
export const COLUMNS =
  "flex flex-col gap-2.5 @min-[560px]/sheet:grid @min-[560px]/sheet:grid-cols-[200px_minmax(0,1fr)] @min-[560px]/sheet:items-start @min-[560px]/sheet:gap-3";
export const ABILITY_GRID =
  "grid grid-cols-2 gap-1.5 @min-[268px]/sheet:grid-cols-3 @min-[560px]/sheet:grid-cols-1 @min-[560px]/sheet:gap-2";

/** FR-CHARX-111: the passive boxes' narrow labels; the full name is in the Tooltip. */
const PASSIVE_SHORT: Readonly<Record<PassiveSkill, string>> = {
  perception: "Perc.",
  investigation: "Invest.",
  insight: "Insight",
};

/** K11: the kit's small stone button (`.btn.sm`), for the compact HP control. */
const SMALL = "h-7 px-2.5 text-[13px]";

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
    <span
      data-testid="char-sheet-ac"
      className="text-[26px] font-bold tabular-nums leading-none @min-[560px]/sheet:text-[36px]"
    >
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
      <ShieldOutline className="size-full max-h-[86px] @min-[560px]/sheet:max-h-[104px]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-1.5 text-foreground">
        <span className={BOX_LABEL}>
          <WideLabel short="AC" full="Armor Class" />
        </span>
        {e ? value : <BreakdownTip okey="ac">{value}</BreakdownTip>}
      </div>
    </div>
  );
}

/**
 * FR-CHARX-106 (kit `.hpbox`): Hit Points: the label across the top; `current / max` with the
 * max as a small unit and "Down" at 0; the HP bar under it; the Temp column on the right (K11,
 * amends OQ-CHARX-47: always there for a character, the `hp` sections, i.e. combat-extras' temp
 * HP control, laid over it). NPC sheets: HP max only.
 */
function HitPoints() {
  const ctx = useSheet();
  const edit = useEdit();
  const store = useSync((st) => st.store);
  const s = ctx.stats;
  const c = ctx.creature;
  const hp = c.kind === "character" ? c.hpCurrent : null;
  const temp = c.kind === "character" ? (c.tempHp ?? 0) : 0;
  const e = ctx.editing && ctx.canEdit;
  const state = hp === null ? null : hpState(hp, s.hpMax);
  if (hp === null) {
    return (
      <Box box="hp" label="HP max" className="col-span-3 @min-[560px]/sheet:col-span-1">
        <span data-testid="char-sheet-hp" className={BOX_VALUE}>
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
            s.hpMax
          )}
        </span>
      </Box>
    );
  }
  const hpSections = ctx.readOnly
    ? []
    : sectionsFor(sheetSections, {
        slot: "hp",
        client: ctx.client,
        kind: c.kind,
        store,
        creatureId: c.id,
      });
  return (
    <div
      data-testid="charx-box"
      data-value="hp"
      data-slot="sheet-box"
      className="col-span-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2.5 gap-y-1 rounded-md border bg-card px-2.5 pt-[5px] pb-2 @min-[560px]/sheet:col-span-1"
    >
      <span className={cn(BOX_LABEL, "col-span-2 truncate text-center")}>
        {hp === null ? "HP max" : "Hit Points"}
      </span>
      <span className="col-start-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {hp !== null && state && (
          <span data-testid="char-sheet-hp" data-state={state} className={BOX_VALUE}>
            {hp}
            <span className={BOX_UNIT}> / {s.hpMax}</span>
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
          <Badge
            data-testid="char-sheet-down"
            className="self-center bg-hp-down text-hp-down-foreground"
          >
            Down
          </Badge>
        )}
      </span>
      {hp !== null && (
        <span
          data-testid="charx-hp-temp"
          data-value={temp}
          className="relative col-start-2 row-span-2 row-start-2 flex flex-col items-center justify-center self-stretch rounded-sm border-l pl-2.5"
        >
          <span className={cn(BOX_LABEL, "text-[11px]")}>Temp</span>
          <span className="text-xl font-bold tabular-nums leading-tight">{temp}</span>
          {hpSections.length > 0 && (
            <SheetSlotView
              slot="hp"
              creatureId={c.id}
              client={ctx.client}
              kind={c.kind}
              className="contents"
            />
          )}
        </span>
      )}
      {hp !== null && state && (
        <span className="col-start-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full", HP_BAR[state])}
            style={{ width: `${Math.max(0, Math.min(100, (hp / s.hpMax) * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}

function Speed() {
  const ctx = useSheet();
  const edit = useEdit();
  const e = ctx.editing && ctx.canEdit;
  const speed = ctx.stats.speed;
  return (
    <Box box="speed" label="Speed">
      <span data-testid="char-sheet-speed" className={BOX_VALUE}>
        {e ? (
          <IntField
            path="speed"
            label="Speed"
            value={speed ?? null}
            min={0}
            max={200}
            optional
            inputClassName="w-full"
            commit={(v) => {
              if (v !== null && v % 5 !== 0) return Promise.reject(new Error("Multiple of 5"));
              return edit("speed", v);
            }}
          />
        ) : speed === undefined ? (
          "—"
        ) : (
          <>
            {speed}
            <span className={BOX_UNIT}> ft</span>
          </>
        )}
      </span>
    </Box>
  );
}

const INIT_LABEL = <WideLabel short="Init" full="Initiative" />;
const INIT_SET = "Initiative set";

/**
 * FR-CHARX-106: the Initiative box is the Initiative button whenever FR-CHAR-24 shows it (routed
 * like the MVP sheet, FR-CHAR-16); otherwise a plain box ("Initiative set" under the value while
 * combat hides the button). Edit mode: the bonus input in the box.
 */
function Initiative() {
  const ctx = useSheet();
  const edit = useEdit();
  const store = useSync((s) => s.store);
  const overrides = useSheetOverrides();
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
      <Box box="init" label={INIT_LABEL}>
        {value}
      </Box>
    );
  }
  if (rollActionView(claim, "initiative") !== "button") {
    return (
      // K11: no "Initiative set" caption (it wrapped at 280 px); it ends the value's Tooltip and
      // stays as screen-reader text (`char-sheet-init-locked`).
      <Box box="init" label={INIT_LABEL}>
        <BreakdownTip
          okey="init"
          note={rollActionView(claim, "initiative") === "locked" ? INIT_SET : undefined}
        >
          {value}
        </BreakdownTip>
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
        className="size-full min-h-12 flex-col justify-start gap-0 px-1 pt-[5px] pb-1.5"
      >
        <span className={BOX_LABEL}>{INIT_LABEL}</span>
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
        {/* "Prof" stays the text (FR-CHAR-22's "Prof +2", CHAR e2e); the wide sheet completes
            the word with a drawn suffix. */}
        <span className={BOX_LABEL}>
          Prof
          <span
            aria-hidden
            className="hidden @min-[560px]/sheet:inline @min-[560px]/sheet:after:content-['iciency']"
          />
        </span>{" "}
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
function StatRow() {
  return (
    <div className={STAT_GRID}>
      <ArmorClass />
      <HitPoints />
      <Speed />
      <Initiative />
      <Proficiency />
    </div>
  );
}

/**
 * FR-CHAR-11 / FR-CHARX-107: amount 1–999 + Damage / Heal, a compact row under the stat row
 * (OQ-CHARX-48 A; K11: small field and small buttons); characters, owner or DM (also locked).
 */
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
    <div data-testid="charx-hp-control" className="flex items-center gap-1.5">
      <Input
        data-testid="char-sheet-hp-input"
        aria-label="HP amount"
        inputMode="numeric"
        placeholder="HP"
        className="h-7 w-16 px-2 text-sm"
        value={raw}
        disabled={!live}
        aria-invalid={raw.trim() !== "" && amount === null}
        onChange={(e) => setRaw(e.target.value)}
      />
      <Button
        data-testid="char-sheet-hp-damage"
        size="sm"
        // K11: a disabled Damage reads quiet (not the strong red) in every theme.
        variant={disabled ? "outline" : "destructive"}
        className={SMALL}
        disabled={disabled}
        onClick={() => send(-1)}
      >
        Damage
      </Button>
      <Button
        data-testid="char-sheet-hp-heal"
        size="sm"
        variant="outline"
        className={SMALL}
        disabled={disabled}
        onClick={() => send(1)}
      >
        Heal
      </Button>
    </div>
  );
}

/**
 * Hit dice (FR-CHARX-17), the kit's vitals group "Hit Dice 3 / 5 d10": the count left is the
 * button (click = use, Shift+click = restore); Reset after it while any is used.
 */
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
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span className={BOX_LABEL}>Hit Dice</span>
      {pips.map((p) => (
        <span key={p.die} className="flex items-center gap-1">
          <Tip
            content={`Hit dice ${p.die}: ${p.used} of ${p.max} used`}
            off={!live || busy.busy || !ctx.canCount}
          >
            <button
              type="button"
              data-testid="charx-hitdie"
              data-value={p.die}
              data-used={p.used}
              aria-label={`Hit dice ${p.die}: ${p.used} of ${p.max} used`}
              disabled={!live || busy.busy || !ctx.canCount}
              className="rounded-sm px-0.5 text-lg font-bold tabular-nums text-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
              onClick={(e) => use({ hitDie: p.die }, { delta: pipDelta(e.shiftKey) })}
            >
              {p.max - p.used} / {p.max}
            </button>
          </Tip>
          <span>{p.die}</span>
          {p.used > 0 && ctx.canCount && (
            <button
              type="button"
              data-testid="charx-resource-reset"
              data-value={`hitDie.${p.die}`}
              disabled={!live || busy.busy}
              className="text-xs text-muted-foreground underline"
              onClick={() => use({ hitDie: p.die }, { reset: true })}
            >
              Reset
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * FR-CHARX-108 (kit `.vitals`): one quiet line: hit dice, then the `vitals` sections (death saves,
 * §7.1); left out when the sheet has neither (FR-CHARX-116: NPC sheets).
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
    <Box
      box="vitals"
      list
      className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-2.5 py-1.5"
    >
      <HitDice />
      {sections.length > 0 && (
        <SheetSlotView
          slot="vitals"
          creatureId={c.id}
          client={ctx.client}
          kind={c.kind}
          className="contents"
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
      {isDm && <PortraitEditor />}
      {"level" in s && <ClassesEditor />}
    </div>
  );
}

const SHAPE_LABEL = { round: "Round", square: "Square", none: "None" } as const;

/**
 * DM only: the one image the sheet header, tokens and Initiative rows show (FR-CHARX-15
 * `portraitAssetId`; copies still on the old portrait follow, FR-CBT-06 / OQ-MAP-14), and the
 * default token shape (FR-ENT-22; null = round; placed tokens on the old one follow, FR-MAP-35).
 * A portrait on a creature with no chosen shape sets `none`: uploaded art brings its own frame.
 */
export function PortraitEditor() {
  const ctx = useSheet();
  const edit = useEdit();
  const intents = useSheetIntents();
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const [picking, setPicking] = useState(false);
  const c = ctx.creature;
  const id = c.portraitAssetId;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Portrait</span>
      <Button
        data-testid="charx-portrait-choose"
        type="button"
        variant="outline"
        size="sm"
        disabled={!live || busy.busy}
        onClick={() => setPicking(true)}
      >
        {id ? "Change…" : "Choose…"}
      </Button>
      {id && (
        <Button
          data-testid="charx-portrait-remove"
          type="button"
          variant="ghost"
          size="sm"
          disabled={!live || busy.busy}
          onClick={() => busy.run(() => edit("portraitAssetId", null))}
        >
          Remove
        </Button>
      )}
      <AssetPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Portrait"
        context="portrait"
        initialSelectedId={id}
        onSelect={(next) =>
          busy.run(() =>
            intents.edit(c.id, {
              portraitAssetId: next,
              ...(c.tokenShape == null ? { tokenShape: "none" } : {}),
            }),
          )
        }
      />
      <div className="ml-auto w-28">
        <SelectField
          path="tokenShape"
          label="Token shape"
          value={c.tokenShape ?? "round"}
          options={TOKEN_SHAPES.map((v) => ({ value: v, label: SHAPE_LABEL[v] }))}
          commit={(v) => edit("tokenShape", v)}
        />
      </div>
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
          <Tip content={`Remove ${r.name}`} off={!live || busy.busy}>
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
          </Tip>
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

/** A proficiency dot (kit `.prof`, 11 px; saves, skills); `double` = expertise, a ringed dot. */
function ProfDot({ on, double = false }: { on: boolean; double?: boolean }) {
  return (
    <span
      data-slot="sheet-pip"
      data-on={on ? "true" : "false"}
      data-double={double ? "true" : undefined}
      className={cn(
        "inline-block size-[11px] shrink-0 rounded-full border-[1.5px] border-foreground/60",
        on ? "bg-foreground" : "bg-transparent",
        double && "ring-[1.5px] ring-foreground/60 ring-offset-2 ring-offset-card",
      )}
    />
  );
}

/**
 * FR-CHARX-109 (FR-CHAR-22's behaviour; kit `.ab`): the label on top; the large signed modifier
 * is the Check button; the score in a pill under it; the Save (proficiency dot, the save as the
 * Save button) under them in the narrow sheet, its own ruled column on the right ("Save" between
 * dot and box) once the sheet is wide.
 */
function AbilityBlock({ a }: { a: Ability }) {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const busy = useBusy();
  const overrides = useSheetOverrides();
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
      className="flex min-w-0 flex-col items-center gap-0.5 rounded-md border bg-card px-1 pt-[5px] pb-1.5 text-center @min-[560px]/sheet:grid @min-[560px]/sheet:grid-cols-[minmax(0,1fr)_70px] @min-[560px]/sheet:gap-y-0.5 @min-[560px]/sheet:px-1.5"
    >
      <span className={cn(BOX_LABEL, "@min-[560px]/sheet:col-span-2")}>
        <span className="@min-[560px]/sheet:hidden">{a.toUpperCase()}</span>
        <span className="hidden @min-[560px]/sheet:inline">{ABILITY_NAMES[a]}</span>
      </span>
      <span className="flex items-center justify-center gap-0.5 @min-[560px]/sheet:col-start-1">
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
          className="h-8 px-1.5 text-2xl font-bold tabular-nums @min-[560px]/sheet:h-11 @min-[560px]/sheet:text-[34px]"
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
      <span className="flex justify-center @min-[560px]/sheet:col-start-1">
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
            className="min-w-[38px] rounded-full border px-2 text-sm text-muted-foreground tabular-nums"
          >
            {scores[a]}
          </span>
        )}
      </span>
      <span className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[13px] text-muted-foreground @min-[560px]/sheet:col-start-2 @min-[560px]/sheet:row-span-2 @min-[560px]/sheet:row-start-2 @min-[560px]/sheet:mt-0 @min-[560px]/sheet:flex-col @min-[560px]/sheet:gap-0.5 @min-[560px]/sheet:self-stretch @min-[560px]/sheet:border-l">
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
          className="flex"
        >
          <ProfDot on={proficient} />
        </span>
        <span className="sr-only @min-[560px]/sheet:not-sr-only">Save</span>
        <SheetRoll
          kind="save"
          rollRef={{ ability: a }}
          title={`${ABILITY_NAMES[a]} save`}
          breakdown={`save.${a}`}
          overrides={overrides}
          data-testid="char-sheet-roll-save"
          data-value={a}
          data-slot="sheet-roll"
          className="h-6 px-1.5 text-[15px] font-bold tabular-nums"
          aria-label={`${ABILITY_NAMES[a]} save ${signed(save)}`}
        >
          <OverrideMark okey={`save.${a}`}>{signed(save)}</OverrideMark>
        </SheetRoll>
        <OverrideEdit okey={`save.${a}`} />
      </span>
    </div>
  );
}

/** FR-CHAR-22 / FR-CHARX-109: the six ability blocks (the DM's switches: the header menu). */
function AbilitiesBlock() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
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
    <div className={ABILITY_GRID}>
      {ABILITIES.map((a) => (
        <AbilityBlock key={a} a={a} />
      ))}
    </div>
  );
}

/**
 * FR-CHARX-110 / -111 (kit `.skillbox`, `.sk`, `.passives`): the Skills box, its label centred
 * over a rule, 18 rows in body type, alphabetical: the proficiency dot (ringed for expertise),
 * name, the muted ability tag, the bonus as a boxed roll button with the d20; proficient rows
 * tinted. Then the passive boxes.
 */
function SkillsBlock() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const overrides = useSheetOverrides();
  const busy = useBusy();
  const rows = skillRows(ctx.stats);
  if (!rows) return null;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div
        data-testid="charx-box"
        data-value="skills"
        data-slot="sheet-box"
        className="flex min-w-0 flex-col rounded-md border bg-card"
      >
        <span
          data-slot="sheet-box-rule"
          className={cn(BOX_LABEL, "border-b px-2.5 pt-1.5 pb-1 text-center")}
        >
          Skills
        </span>
        <div className="flex flex-col py-0.5">
          {rows.map((r) => (
            <div
              key={r.skill}
              data-testid="charx-skill"
              data-value={r.skill}
              data-proficiency={r.proficiency ?? "none"}
              data-slot="sheet-skill-row"
              className={cn(
                "flex min-h-7 items-center gap-2 py-0.5 pr-2 pl-2.5 text-[15px]",
                r.proficiency && "bg-muted/60",
              )}
            >
              <Tip
                content={`${r.name} proficiency: ${r.proficiency ?? "none"}`}
                off={!e || !live || busy.busy}
              >
                <button
                  type="button"
                  data-testid="charx-field"
                  data-value={`skills.${r.skill}`}
                  aria-label={`${r.name} proficiency: ${r.proficiency ?? "none"}`}
                  disabled={!e || !live || busy.busy}
                  className="flex w-3 shrink-0 justify-center disabled:cursor-default"
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
              </Tip>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="w-[34px] shrink-0 text-xs tracking-wide text-muted-foreground">
                {r.abbr}
              </span>
              <SheetRoll
                kind="skill"
                rollRef={{ skill: r.skill }}
                title={`${r.name} check`}
                breakdown={`skill.${r.skill}`}
                overrides={overrides}
                data-testid="charx-roll-skill"
                data-value={r.skill}
                data-slot="sheet-roll"
                className="h-6 min-w-[54px] justify-between gap-1 px-1.5 text-base font-bold"
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
      </div>
      <div data-testid="charx-box" data-value="passives" className="grid grid-cols-3 gap-1.5">
        {passives(ctx.stats).map((p) => (
          <div
            key={p.skill}
            data-slot="sheet-box"
            className="flex min-w-0 flex-col items-center rounded-md border bg-card px-1 pt-[5px] pb-1.5 text-center"
          >
            <span className={cn(BOX_LABEL, "max-w-full truncate")}>
              <span className="@min-[560px]/sheet:hidden">{PASSIVE_SHORT[p.skill]}</span>
              <span className="hidden @min-[560px]/sheet:inline">{p.name}</span>
            </span>
            <span className="text-[22px] font-bold tabular-nums leading-[1.15] @min-[560px]/sheet:text-[28px]">
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
  const wide = useContext(SheetWide);
  const kind = ctx.creature.kind;
  return (
    <div className="flex flex-col gap-2.5">
      {ctx.editing && ctx.canEdit && <IdentityEditor />}
      <StatRow />
      <HpControl />
      <VitalsBox />
      <SensesLine />
      <Columns>
        <AbilitiesBlock />
        <SkillsBlock />
      </Columns>
      {/* K13: the kit's wide sheet: the action boxes span both columns, under them. */}
      {wide && <WideActionBoxes />}
      {!ctx.readOnly && (
        <SheetSlotView slot="main" creatureId={ctx.creature.id} client={ctx.client} kind={kind} />
      )}
    </div>
  );
}
