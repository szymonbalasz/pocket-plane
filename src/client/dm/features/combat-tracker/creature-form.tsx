// Creature form (FR-CBT-05, FR-CBT-43, #85): New (blank), Derive (any monster; name = base, or
// "‹name› (copy)" for a custom), Edit (customs only). Creature core fields + speed, token shape,
// the six ability scores (all or none) and save proficiencies; entities' zod and REST (`POST` /
// `PUT /api/entities`); server errors shown inline. PUT is a whole replace: the form always sends
// `tokenShape` (Default = null) and the whole stat block (source fields kept). Sprint 2: optional
// HP formula with an "Average N" hint and "Use as HP max" (FR-CBT-62, FR-ENT-25). Sprint 4: the
// first attack's `bonus` / `extraDamage` (and the rows after it) ride through (FR-CBT-86); the
// monster **Type** (14 SRD types + None, FR-CBT-43 S4 / FR-ENT-26): Derive and Edit prefill it,
// None omits `type`. Sprint 6: editing a pet keeps its `companionOf` / `turnMode` (FR-ENT-33).

import { hpAverage, parseHpFormula } from "@shared/entities/hp-formula";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  CR_VALUES,
  CREATURE_TYPES,
  DAMAGE_TYPES,
  type DefinitionRecord,
  MonsterStatBlock,
  SIZES,
  TOKEN_SHAPES,
  type TokenShape,
  type TurnMode,
  xpForCr,
} from "@shared/entities/schemas";
import { copyName } from "@shared/scenes-map/geometry";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import { creatureTypeLabel } from "@ui/features/entities/art";
import { CopyPlusIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import type { CreatureAction } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";
import { combatRest } from "./rest";

export type Mode =
  | { kind: "new" }
  | { kind: "derive"; base: DefinitionRecord }
  | { kind: "edit"; def: DefinitionRecord };

export interface Fields {
  name: string;
  size: string;
  ac: string;
  hpMax: string;
  initBonus: string;
  cr: string;
  portraitAssetId: string | null;
  attackName: string;
  toHit: string;
  damage: string;
  damageType: string;
  speed: string;
  tokenShape: TokenShape | typeof DEFAULT_SHAPE;
  abilities: Record<Ability, string>;
  saves: Ability[];
  /** FR-ENT-25: "" = none. Absent = not shown: the source's formula is kept. */
  hpFormula?: string;
  /** FR-ENT-26: a creature type or `NONE`. Absent = not shown: the source's type is kept. */
  type?: string;
}

const NONE = "__none__";
const DEFAULT_SHAPE = "default";
const SHAPE_LABEL: Record<TokenShape | typeof DEFAULT_SHAPE, string> = {
  default: "Default",
  round: "Round",
  square: "Square",
  none: "None",
};

export function initial(mode: Mode): Fields {
  const src = mode.kind === "derive" ? mode.base : mode.kind === "edit" ? mode.def : null;
  const sb = src?.kind === "monster" ? src.statBlock : null;
  const a = sb?.attacks[0];
  const name =
    mode.kind === "derive"
      ? mode.base.campaignId === null
        ? mode.base.name
        : copyName(mode.base.name)
      : (src?.name ?? "");
  return {
    name,
    size: sb?.size ?? "medium",
    ac: String(sb?.ac ?? 10),
    hpMax: String(sb?.hpMax ?? 10),
    initBonus: String(sb?.initBonus ?? 0),
    cr: sb?.cr ?? "1",
    portraitAssetId: src?.portraitAssetId ?? null,
    attackName: a?.name ?? "",
    toHit: a ? String(a.toHit) : "",
    damage: a?.damage ?? "",
    damageType: a?.damageType ?? NONE,
    speed: sb?.speed === undefined ? "" : String(sb.speed),
    tokenShape: (src && "tokenShape" in src ? src.tokenShape : null) ?? DEFAULT_SHAPE,
    abilities: Object.fromEntries(
      ABILITIES.map((k) => [k, sb?.abilities ? String(sb.abilities[k]) : ""]),
    ) as Record<Ability, string>,
    saves: sb?.saveProficiencies ? [...sb.saveProficiencies] : [],
    hpFormula: sb?.hpFormula ?? "",
    type: sb?.type ?? NONE,
  };
}

/**
 * FR-ENT-33 (sprint 6): `PUT` is a whole replace, so editing a pet sends the `companionOf` /
 * `turnMode` it loaded (omitted = null would release it). Nothing for other creatures.
 */
export function keptPetFields(
  def: DefinitionRecord,
): { companionOf: string; turnMode: TurnMode | null } | Record<string, never> {
  return def.kind === "monster" && def.campaignId !== null && def.companionOf !== null
    ? { companionOf: def.companionOf, turnMode: def.turnMode }
    : {};
}

/** FR-CBT-86: attack fields the form doesn't show; kept from the attack it loaded. */
const KEPT_ATTACK_FIELDS: readonly string[] = ["id", "bonus", "extraDamage"];

/** FR-CBT-62: the form's "Average N" hint, or null while the formula is empty / invalid. */
export function formulaAverage(formula: string): number | null {
  return formula.trim() !== "" && parseHpFormula(formula) ? hpAverage(formula) : null;
}

/** The stat block the form sends: the source's (Edit / Derive) with the shown fields replaced. */
export function formStatBlock(
  f: Fields,
  source: Record<string, unknown> | null,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const filled = ABILITIES.filter((k) => f.abilities[k].trim() !== "");
  if (filled.length !== 0 && filled.length !== ABILITIES.length) {
    return { ok: false, message: "Ability scores: fill all six or none" };
  }
  const {
    speed: _speed,
    abilities: _abilities,
    saveProficiencies: _saves,
    hpFormula: sourceFormula,
    type: sourceType,
    ...rest
  } = source ?? {};
  const formula = f.hpFormula === undefined ? sourceFormula : f.hpFormula.trim() || undefined;
  const type = f.type === undefined ? sourceType : f.type === NONE ? undefined : f.type;
  // FR-CBT-86: the loaded attack keeps what the form doesn't edit (row id, `bonus`,
  // `extraDamage`; the NPC sheet edits them) and the rows after it ride along, so Edit never
  // drops them.
  const [first, ...others] = Array.isArray(rest.attacks)
    ? (rest.attacks as Record<string, unknown>[])
    : [];
  const kept = Object.fromEntries(
    Object.entries(first ?? {}).filter(([k]) => KEPT_ATTACK_FIELDS.includes(k)),
  );
  const attacks =
    f.attackName.trim() === ""
      ? others
      : [
          {
            ...kept,
            name: f.attackName,
            toHit: Number(f.toHit),
            damage: f.damage.trim(),
            ...(f.damageType !== NONE ? { damageType: f.damageType } : {}),
          },
          ...others,
        ];
  const abilities =
    filled.length === 0
      ? undefined
      : (Object.fromEntries(ABILITIES.map((k) => [k, Number(f.abilities[k])])) as Record<
          Ability,
          number
        >);
  return {
    ok: true,
    value: {
      ...rest,
      size: f.size,
      ac: Number(f.ac),
      hpMax: Number(f.hpMax),
      initBonus: Number(f.initBonus),
      cr: f.cr,
      attacks,
      ...(formula !== undefined ? { hpFormula: formula } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(f.speed.trim() !== "" ? { speed: Number(f.speed) } : {}),
      ...(abilities ? { abilities } : {}),
      ...(abilities && f.saves.length > 0
        ? { saveProficiencies: ABILITIES.filter((k) => f.saves.includes(k)) }
        : {}),
    },
  };
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1" data-testid="cbt-form-field" data-field={id}>
      <Label htmlFor={`cbt-form-${id}`}>{label}</Label>
      {children}
    </div>
  );
}

export function CreatureForm({ mode, close }: { mode: Mode; close(): void }) {
  const [f, setF] = useState<Fields>(() => initial(mode));
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Fields) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const average = formulaAverage(f.hpFormula ?? "");

  const save = async () => {
    const src = mode.kind === "derive" ? mode.base : mode.kind === "edit" ? mode.def : null;
    const block = formStatBlock(
      f,
      src?.kind === "monster" ? (src.statBlock as Record<string, unknown>) : null,
    );
    if (!block.ok) {
      setError(block.message);
      return;
    }
    const parsed = MonsterStatBlock.safeParse(block.value);
    const tokenShape = f.tokenShape === DEFAULT_SHAPE ? null : f.tokenShape;
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      setError(i ? `${i.path.join(".")}: ${i.message}` : "Invalid stat block");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === "edit") {
        await combatRest.updateEntity(mode.def.id, {
          name: f.name,
          portraitAssetId: f.portraitAssetId,
          tokenShape,
          statBlock: parsed.data,
          ...keptPetFields(mode.def),
        });
      } else {
        await combatRest.createEntity({
          kind: "monster",
          name: f.name,
          portraitAssetId: f.portraitAssetId,
          tokenShape,
          statBlock: parsed.data,
          ...(mode.kind === "derive" ? { derivedFromId: mode.base.id } : {}),
        });
      }
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode.kind === "new"
      ? "New creature"
      : mode.kind === "derive"
        ? "Derive creature"
        : "Edit creature";
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="col-span-2">
          <Field id="name" label="Name">
            <Input id="cbt-form-name" value={f.name} onChange={set("name")} autoFocus />
          </Field>
        </div>
        <Field id="size" label="Size">
          <Select value={f.size} onValueChange={(v) => setF((x) => ({ ...x, size: v }))}>
            <SelectTrigger id="cbt-form-size" className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="cr" label={`CR (${xpForCr(f.cr)} XP)`}>
          <Select value={f.cr} onValueChange={(v) => setF((x) => ({ ...x, cr: v }))}>
            <SelectTrigger id="cbt-form-cr" className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CR_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="type" label="Type">
          <Select value={f.type ?? NONE} onValueChange={(v) => setF((x) => ({ ...x, type: v }))}>
            <SelectTrigger id="cbt-form-type" data-testid="cbt-form-type" className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE} data-value="none">
                None
              </SelectItem>
              {CREATURE_TYPES.map((t) => (
                <SelectItem key={t} value={t} data-value={t}>
                  {creatureTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="ac" label="AC">
          <Input id="cbt-form-ac" inputMode="numeric" value={f.ac} onChange={set("ac")} />
        </Field>
        <Field id="hpMax" label="HP max">
          <Input id="cbt-form-hpMax" inputMode="numeric" value={f.hpMax} onChange={set("hpMax")} />
        </Field>
        <Field id="hpFormula" label="HP formula">
          <Input
            id="cbt-form-hpFormula"
            placeholder="2d6+2"
            value={f.hpFormula ?? ""}
            onChange={set("hpFormula")}
          />
          {average !== null && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              Average {average}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                data-testid="cbt-form-hp-average"
                onClick={() => setF((x) => ({ ...x, hpMax: String(average) }))}
              >
                Use as HP max
              </Button>
            </span>
          )}
        </Field>
        <Field id="initBonus" label="Initiative bonus">
          <Input
            id="cbt-form-initBonus"
            inputMode="numeric"
            value={f.initBonus}
            onChange={set("initBonus")}
          />
        </Field>
        <Field id="speed" label="Speed (ft)">
          <Input
            id="cbt-form-speed"
            type="number"
            min={0}
            max={200}
            step={5}
            placeholder="—"
            value={f.speed}
            onChange={set("speed")}
          />
        </Field>
        <Field id="tokenShape" label="Token shape">
          <Select
            value={f.tokenShape}
            onValueChange={(v) => setF((x) => ({ ...x, tokenShape: v as Fields["tokenShape"] }))}
          >
            <SelectTrigger id="cbt-form-tokenShape" className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[DEFAULT_SHAPE, ...TOKEN_SHAPES].map((s) => (
                <SelectItem key={s} value={s} data-value={s}>
                  {SHAPE_LABEL[s as Fields["tokenShape"]]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="portrait" label="Portrait">
          <Button
            id="cbt-form-portrait"
            // FR-CBT-151 (sim-10 small copy).
            data-testid="cbt-form-portrait"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPicking(true)}
          >
            {f.portraitAssetId ? "Change…" : "Choose…"}
          </Button>
        </Field>
        <div className="col-span-2 grid grid-cols-2 gap-3 rounded-md border p-2">
          <p className="col-span-2 text-xs text-muted-foreground">Attack (optional)</p>
          <Field id="attackName" label="Name">
            <Input id="cbt-form-attackName" value={f.attackName} onChange={set("attackName")} />
          </Field>
          <Field id="toHit" label="To hit">
            <Input
              id="cbt-form-toHit"
              inputMode="numeric"
              value={f.toHit}
              onChange={set("toHit")}
            />
          </Field>
          <Field id="damage" label="Damage">
            <Input
              id="cbt-form-damage"
              placeholder="1d6+2"
              value={f.damage}
              onChange={set("damage")}
            />
          </Field>
          <Field id="damageType" label="Damage type">
            <Select
              value={f.damageType}
              onValueChange={(v) => setF((x) => ({ ...x, damageType: v }))}
            >
              <SelectTrigger id="cbt-form-damageType" className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {DAMAGE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="col-span-2 grid gap-2 rounded-md border p-2">
          <p className="text-xs text-muted-foreground">
            Ability scores (all six or none) · save proficiency
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {ABILITIES.map((k) => (
              <div
                key={k}
                className="grid justify-items-center gap-1"
                data-testid="cbt-form-field"
                data-field={`abilities.${k}`}
              >
                <Tooltip content={ABILITY_NAMES[k]}>
                  <Label htmlFor={`cbt-form-ability-${k}`}>{k.toUpperCase()}</Label>
                </Tooltip>
                <Input
                  id={`cbt-form-ability-${k}`}
                  inputMode="numeric"
                  className="h-8 px-1 text-center"
                  value={f.abilities[k]}
                  onChange={(e) =>
                    setF((x) => ({ ...x, abilities: { ...x.abilities, [k]: e.target.value } }))
                  }
                />
                <Checkbox
                  data-testid="cbt-form-field"
                  data-field={`saves.${k}`}
                  aria-label={`${ABILITY_NAMES[k]} save proficiency`}
                  checked={f.saves.includes(k)}
                  onCheckedChange={(v) =>
                    setF((x) => ({
                      ...x,
                      saves: v === true ? [...x.saves, k] : x.saves.filter((s) => s !== k),
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
        {error && (
          <p data-testid="cbt-form-error" className="col-span-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="col-span-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button data-testid="cbt-form-save" type="submit" disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </form>
      <AssetPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Portrait"
        context="portrait"
        initialSelectedId={f.portraitAssetId}
        onSelect={(id) => setF((x) => ({ ...x, portraitAssetId: id }))}
      />
    </>
  );
}

function FormDialog({ mode, onClose }: { mode: Mode | null; onClose(): void }) {
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="cbt-form" className="max-w-lg" aria-describedby={undefined}>
        {mode && <CreatureForm mode={mode} close={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NewAction() {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid="cbt-form-new"
        onClick={() => setMode({ kind: "new" })}
      >
        <PlusIcon className="size-4" /> New
      </Button>
      <FormDialog mode={mode} onClose={() => setMode(null)} />
    </>
  );
}

function RowActions({ row }: { row: CreatureRow }) {
  const [mode, setMode] = useState<Mode | null>(null);
  if (row.kind !== "monster") return null;
  return (
    <span className="inline-flex">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        data-testid="cbt-form-derive"
        data-record-id={row.id}
        aria-label={`Derive from ${row.name}`}
        onClick={() => setMode({ kind: "derive", base: row.definition })}
      >
        <CopyPlusIcon className="size-3.5" />
      </Button>
      {!row.readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          data-testid="cbt-form-edit"
          data-record-id={row.id}
          aria-label={`Edit ${row.name}`}
          onClick={() => setMode({ kind: "edit", def: row.definition })}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      )}
      <FormDialog mode={mode} onClose={() => setMode(null)} />
    </span>
  );
}

export const combatCreatureActions: readonly CreatureAction[] = [
  { placement: "toolbar", id: "cbt.new", component: NewAction },
  { placement: "row", id: "cbt.derive-edit", component: RowActions },
];
