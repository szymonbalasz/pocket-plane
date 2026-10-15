// Main tab (CHARX §7): stat row + HP, Initiative (FR-CHAR-03; no attack row, FR-CHARX-44), hit
// dice, vitals sections, Abilities block (FR-CHAR-22), Skills block + passives, main sections.
// Edit mode: identity, scores, proficiencies, stats and overrides in place (FR-CHARX-27).

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
import { PublicSwitch, usePublicOverrides } from "./rolls";
import { rollActionView, routeFor } from "./routing";
import { SheetSlotView } from "./SheetSections";
import { useSheet, useSheetIntents } from "./sheet-context";
import {
  hitDicePips,
  nextProficiency,
  overrideTooltip,
  passives,
  pipDelta,
  skillRows,
  withSkill,
} from "./view-model";

const HP_CLASS = { full: "text-hp-full", bloodied: "text-hp-bloodied", down: "text-hp-down" };

function Stat({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span data-testid={testId} className="text-lg font-semibold tabular-nums leading-tight">
        {children}
      </span>
    </div>
  );
}

/** `char.edit` of one key; returns the intent promise (fields handle failure). */
function useEdit() {
  const ctx = useSheet();
  const intents = useSheetIntents();
  return (key: string, value: unknown) => intents.edit(ctx.creature.id, { [key]: value });
}

function StatRow() {
  const ctx = useSheet();
  const edit = useEdit();
  const s = ctx.stats;
  const c = ctx.creature;
  const hp = c.kind === "character" ? c.hpCurrent : null;
  const e = ctx.editing && ctx.canEdit;
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <Stat label="AC" testId="char-sheet-ac">
        {e ? (
          <IntField
            path="ac"
            label="AC"
            value={s.ac}
            min={0}
            max={30}
            commit={(v) => edit("ac", v)}
          />
        ) : (
          s.ac
        )}
      </Stat>
      <div className="flex flex-col items-start">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {hp === null ? "HP max" : "HP"}
        </span>
        <span className="flex items-center gap-1.5">
          {hp !== null && (
            <span
              data-testid="char-sheet-hp"
              data-state={hpState(hp, s.hpMax)}
              className={cn(
                "text-lg font-semibold tabular-nums leading-tight",
                HP_CLASS[hpState(hp, s.hpMax)],
              )}
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
              <span data-testid="char-sheet-hp" className="text-lg font-semibold tabular-nums">
                {s.hpMax}
              </span>
            )
          )}
          {hp !== null && isDown(hp) && (
            <Badge data-testid="char-sheet-down" className="bg-hp-down text-white">
              Down
            </Badge>
          )}
        </span>
      </div>
      <Stat label="Speed" testId="char-sheet-speed">
        {e ? (
          <IntField
            path="speed"
            label="Speed"
            value={s.speed ?? null}
            min={0}
            max={200}
            optional
            commit={(v) => {
              if (v !== null && v % 5 !== 0) return Promise.reject(new Error("Multiple of 5"));
              return edit("speed", v);
            }}
          />
        ) : (
          speedText(s.speed)
        )}
      </Stat>
      <Stat label="Init" testId="char-sheet-init">
        {e ? (
          <IntField
            path="initBonus"
            label="Initiative bonus"
            value={s.initBonus}
            min={-10}
            max={20}
            commit={(v) => edit("initBonus", v)}
          />
        ) : (
          signed(s.initBonus)
        )}
      </Stat>
      <Stat label="Prof" testId="charx-prof">
        <OverrideControl okey="proficiency">{signed(proficiencyBonus(s))}</OverrideControl>
      </Stat>
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
 * Initiative, routed like the MVP sheet (FR-CHAR-16/24). No attack row: attacks are rolled on
 * the Actions tab only (FR-CHARX-44, N4).
 */
function QuickActions() {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const overrides = usePublicOverrides();
  const initClaim = routeFor(rollRoutes, store, ctx.creature.id, "initiative");
  // FR-CHAR-24: a hidden claim shows no button and no public switch.
  const showInit = rollActionView(initClaim, "initiative") === "button";
  return (
    <div className="flex items-center justify-end gap-2">
      {showInit && (
        <PublicSwitch
          category="initiative"
          label="Public"
          testId="char-sheet-public-init"
          overrides={overrides}
        />
      )}
      <RoutedRoll
        kind="initiative"
        title="Initiative"
        overrides={overrides}
        data-testid="char-sheet-roll-init"
      >
        Initiative
      </RoutedRoll>
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
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Hit dice</span>
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

/** FR-CHAR-19/22 + overrides: "Prof", six cells (scores editable), checks and saves. */
function AbilitiesBlock() {
  const ctx = useSheet();
  const edit = useEdit();
  const live = useSync((s) => s.state === "live");
  const overrides = usePublicOverrides();
  const busy = useBusy();
  const s = ctx.stats;
  const e = ctx.editing && ctx.canEdit;
  if (!s.abilities) {
    return (
      <div className="flex items-center justify-between gap-2 border-t pt-3">
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
  const scores = s.abilities;
  const profs = s.saveProficiencies ?? [];
  const toggleSave = (a: Ability) => {
    const next = profs.includes(a) ? profs.filter((x) => x !== a) : [...profs, a];
    busy.run(() => edit("saveProficiencies", next.length ? next : null));
  };
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-testid="char-sheet-prof" className="text-xs font-medium text-muted-foreground">
          Prof {signed(proficiencyBonus(s))}
        </span>
        <span className="flex items-center gap-2">
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
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ABILITIES.map((a) => {
          const check = checkBonus(s, a) as number;
          const save = saveBonus(s, a) as number;
          const proficient = profs.includes(a);
          const mod = Math.floor((scores[a] - 10) / 2);
          return (
            <div
              key={a}
              data-testid="char-sheet-ability"
              data-value={a}
              className="flex flex-col gap-1 rounded-md border p-1.5"
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {a.toUpperCase()}
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
                  <span className="text-sm tabular-nums">
                    <span data-testid="char-sheet-ability-score" data-value={a}>
                      {scores[a]}
                    </span>{" "}
                    <span
                      data-testid="char-sheet-ability-mod"
                      data-value={a}
                      className="text-muted-foreground"
                    >
                      ({signed(mod)})
                    </span>
                  </span>
                )}
              </div>
              <span className="flex items-center gap-0.5">
                <SheetRoll
                  kind="check"
                  rollRef={{ ability: a }}
                  title={`${ABILITY_NAMES[a]} check`}
                  hint={overrideTooltip(s, `check.${a}`) ?? undefined}
                  overrides={overrides}
                  data-testid="char-sheet-roll-check"
                  data-value={a}
                  className="h-6 w-full justify-between gap-1 px-2 text-xs"
                  aria-label={`${ABILITY_NAMES[a]} check ${signed(check)}`}
                >
                  <span>Check</span>
                  <OverrideMark okey={`check.${a}`}>
                    <span className="tabular-nums">{signed(check)}</span>
                  </OverrideMark>
                </SheetRoll>
                <OverrideEdit okey={`check.${a}`} />
              </span>
              <span className="flex items-center gap-0.5">
                {e && (
                  <Checkbox
                    data-testid="charx-field"
                    data-value={`saveProficiencies.${a}`}
                    aria-label={`${ABILITY_NAMES[a]} save proficiency`}
                    checked={proficient}
                    disabled={!live || busy.busy}
                    onCheckedChange={() => toggleSave(a)}
                  />
                )}
                <SheetRoll
                  kind="save"
                  rollRef={{ ability: a }}
                  title={`${ABILITY_NAMES[a]} save`}
                  hint={
                    [
                      proficient ? `${ABILITY_NAMES[a]} save · Proficient` : null,
                      overrideTooltip(s, `save.${a}`),
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  overrides={overrides}
                  data-testid="char-sheet-roll-save"
                  data-value={a}
                  className="h-6 w-full justify-between gap-1 px-2 text-xs"
                  aria-label={`${ABILITY_NAMES[a]} save ${signed(save)}`}
                >
                  <span>Save</span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <OverrideMark okey={`save.${a}`}>{signed(save)}</OverrideMark>
                    <span
                      data-testid="char-sheet-save-prof"
                      data-value={a}
                      data-proficient={proficient ? "true" : "false"}
                      className={cn(
                        "size-1.5 rounded-full",
                        proficient ? "bg-foreground" : "bg-transparent",
                      )}
                    />
                  </span>
                </SheetRoll>
                <OverrideEdit okey={`save.${a}`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Skills block (CHARX §7): 18 rows, proficiency dots, bonus = roll button; passives under it. */
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
    <div className="flex flex-col gap-1 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Skills</span>
        <PublicSwitch
          category="skill-check"
          label="Public"
          testId="charx-public-skill"
          overrides={overrides}
        />
      </div>
      <div className="flex flex-col">
        {rows.map((r) => (
          <div
            key={r.skill}
            data-testid="charx-skill"
            data-value={r.skill}
            data-proficiency={r.proficiency ?? "none"}
            className="flex items-center gap-1.5 text-xs"
          >
            <button
              type="button"
              data-testid="charx-field"
              data-value={`skills.${r.skill}`}
              aria-label={`${r.name} proficiency: ${r.proficiency ?? "none"}`}
              disabled={!e || !live || busy.busy}
              className="flex w-4 justify-center gap-px disabled:cursor-default"
              onClick={() =>
                busy.run(() => {
                  const next = withSkill(ctx.stats.skills, r.skill, nextProficiency(r.proficiency));
                  return edit("skills", Object.keys(next).length ? next : null);
                })
              }
            >
              <span
                className={cn(
                  "size-1.5 rounded-full border border-foreground/60",
                  r.proficiency && "bg-foreground",
                )}
              />
              {r.proficiency === "expertise" && (
                <span className="size-1.5 rounded-full bg-foreground" />
              )}
            </button>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="w-7 text-[10px] text-muted-foreground">{r.abbr}</span>
            <SheetRoll
              kind="skill"
              rollRef={{ skill: r.skill }}
              title={`${r.name} check`}
              hint={overrideTooltip(ctx.stats, `skill.${r.skill}`) ?? undefined}
              overrides={overrides}
              data-testid="charx-roll-skill"
              data-value={r.skill}
              className="h-5 min-w-12 justify-end px-1.5 text-xs"
              aria-label={`${r.name} ${signed(r.bonus)}`}
            >
              <OverrideMark okey={`skill.${r.skill}`}>
                <span data-testid="charx-skill-bonus" data-value={r.skill} className="tabular-nums">
                  {signed(r.bonus)}
                </span>
              </OverrideMark>
            </SheetRoll>
            <OverrideEdit okey={`skill.${r.skill}`} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-0.5 pt-1 text-xs">
        {passives(ctx.stats).map((p) => (
          <div key={p.skill} className="flex items-center justify-between">
            <span className="text-muted-foreground">{p.name}</span>
            <OverrideControl okey={`passive.${p.skill}`}>
              <span data-testid="charx-passive" data-value={p.skill} className="tabular-nums">
                {p.value}
              </span>
            </OverrideControl>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MainTab() {
  const ctx = useSheet();
  const kind = ctx.creature.kind;
  return (
    <div className="flex flex-col gap-3">
      {ctx.editing && ctx.canEdit && <IdentityEditor />}
      <StatRow />
      <HpControl />
      {!ctx.readOnly && (
        <SheetSlotView slot="vitals" creatureId={ctx.creature.id} client={ctx.client} kind={kind} />
      )}
      <HitDice />
      <QuickActions />
      <AbilitiesBlock />
      <SkillsBlock />
      {!ctx.readOnly && (
        <SheetSlotView slot="main" creatureId={ctx.creature.id} client={ctx.client} kind={kind} />
      )}
    </div>
  );
}
