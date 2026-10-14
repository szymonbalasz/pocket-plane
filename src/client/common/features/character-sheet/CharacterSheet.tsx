// Window `char.sheet` body, both clients (CHAR §7). A view over the `entity` record of kind
// `character` (FR-CHAR-01); every change goes out as an intent (`char.roll`, `char.adjustHp`, or a
// claimed roll route, FR-CHAR-16). DM-only parts (owner names, public switches) from `you.role`.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  type AbilityCell,
  abilityBlock,
  attackLine,
  characterRolls,
  eligibleCharacters,
  hpState,
  initials,
  isDown,
  levelLine,
  parseHpAmount,
  selectCharacter,
  sheetAttack,
  signed,
  speedText,
} from "@shared/character-sheet/logic";
import { type AbilityRollKind, CHAR_ADJUST_HP } from "@shared/character-sheet/schemas";
import {
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
} from "@shared/dice-roll-log/schemas";
import {
  ABILITY_NAMES,
  type Ability,
  type CharacterRecord,
  ENTITY_TYPE,
  type EntityRecord,
} from "@shared/entities/schemas";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Card, Input, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import { rollRoutes } from "./roll-routes";
import {
  createInFlight,
  intentErrorText,
  type RollRouteInput,
  routeFor,
  sendSheetRoll,
  sheetBadge,
} from "./routing";

const SELECT =
  "h-8 min-w-0 max-w-36 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const HP_CLASS = { full: "text-hp-full", bloodied: "text-hp-bloodied", down: "text-hp-down" };

/** FR-CHAR-25: roll hint, a shared Tooltip (never a native `title`). */
const ROLL_HINT = "Shift: advantage · Ctrl: disadvantage";

/** FR-CHAR-12: one intent in flight per control; failures → Toast. */
function useInFlight() {
  const [busy, setBusy] = useState(false);
  const ref = useRef<ReturnType<typeof createInFlight> | null>(null);
  if (!ref.current) ref.current = createInFlight(setBusy);
  const f = ref.current;
  return {
    busy,
    run: (fn: () => Promise<unknown>) => f.run(fn, (err) => toast.error(intentErrorText(err))),
  };
}

function Portrait({ c }: { c: CharacterRecord }) {
  const cls = "size-11 shrink-0 overflow-hidden rounded-full";
  return (
    <div data-testid="char-sheet-portrait" className={cls}>
      {c.portraitAssetId ? (
        <AssetImg id={c.portraitAssetId} file="thumb" alt={c.name} className="size-full" />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-sm font-semibold text-muted-foreground">
          {initials(c.name)}
        </div>
      )}
    </div>
  );
}

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

/** Initiative / Attack button through the shared roll control (FR-DICE-24, FR-CHAR-16). */
function RollAction({
  c,
  kind,
  testId,
  publicTestId,
  label,
}: {
  c: CharacterRecord;
  kind: "initiative" | "attack";
  testId: string;
  publicTestId: string;
  label: string;
}) {
  const live = useSync((s) => s.state === "live");
  const store = useSync((s) => s.store);
  const connection = useSync((s) => s.connection);
  const claim = routeFor(rollRoutes, store, c.id, kind);
  const specs = characterRolls(c.statBlock, kind) ?? [];
  const flight = useInFlight();
  const uid = useId();
  const control = useRollControl({
    expressions: specs.map((s) => s.expression),
    category: kind,
    label: specs[0] ? `${c.name} — ${specs[0].label}` : undefined,
    critExpressions: claim?.critExpressions,
    onRoll(r) {
      flight.run(() => sendSheetRoll((n, p) => connection.sendIntent(n, p), claim, c.id, kind, r));
    },
  });
  return (
    <div className="flex items-center gap-2">
      {control.isDm && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Switch
            id={`${uid}-public`}
            data-testid={publicTestId}
            aria-label={`${label} roll public`}
            checked={control.publicValue}
            disabled={!live}
            onCheckedChange={control.setPublic}
          />
          <label htmlFor={`${uid}-public`}>Public</label>
        </span>
      )}
      <Tooltip content={ROLL_HINT}>
        <RollButton
          control={control}
          data-testid={testId}
          type="button"
          size="sm"
          variant="secondary"
          disabled={!live || flight.busy || specs.length === 0}
        >
          {label}
        </RollButton>
      </Tooltip>
      {control.error && <span className="text-xs text-destructive">{control.error}</span>}
    </div>
  );
}

const ABILITY_CATEGORY = { check: "ability-check", save: "saving-throw" } as const;

/** DM per-roll public override per category; absent = the category's setting. */
type PublicOverrides = Partial<Record<AbilityRollKind, boolean>>;

/**
 * One Check / Save button: a shared roll control over one expression (FR-CHAR-22). Routed like
 * any sheet roll (FR-CHAR-16); combat never claims it (FR-CHAR-23), so it sends `char.roll`.
 */
function AbilityRoll({
  c,
  kind,
  ability,
  bonus,
  proficient,
  publicOverride,
  onRolled,
}: {
  c: CharacterRecord;
  kind: AbilityRollKind;
  ability: Ability;
  bonus: number;
  proficient?: boolean;
  publicOverride: boolean | undefined;
  onRolled(): void;
}) {
  const live = useSync((s) => s.state === "live");
  const store = useSync((s) => s.store);
  const connection = useSync((s) => s.connection);
  const claim = routeFor(rollRoutes, store, c.id, kind);
  const specs = characterRolls(c.statBlock, kind, ability) ?? [];
  const flight = useInFlight();
  const control = useRollControl({
    expressions: specs.map((s) => s.expression),
    category: ABILITY_CATEGORY[kind],
    label: `${c.name} — ${ABILITY_NAMES[ability]} ${kind}`,
    onRoll(r) {
      const input: RollRouteInput =
        control.isDm && publicOverride !== undefined ? { ...r, public: publicOverride } : r;
      onRolled();
      flight.run(() =>
        sendSheetRoll((n, p) => connection.sendIntent(n, p), claim, c.id, kind, input, ability),
      );
    },
  });
  const name = `${ABILITY_NAMES[ability]} ${kind}`;
  // FR-CHAR-25: one Tooltip per button; the "Proficient" mark sits inside it, so it joins the
  // button's hint rather than nesting a second trigger.
  const hint = `${name}${kind === "save" && proficient ? " · Proficient" : ""} · ${ROLL_HINT}`;
  return (
    <Tooltip content={hint}>
      <RollButton
        control={control}
        data-testid={`char-sheet-roll-${kind}`}
        data-value={ability}
        type="button"
        size="sm"
        variant="secondary"
        className="h-6 w-full justify-between gap-1 px-2 text-xs"
        aria-label={`${name} ${signed(bonus)}`}
        disabled={!live || flight.busy || specs.length === 0}
      >
        <span>{kind === "check" ? "Check" : "Save"}</span>
        <span className="flex items-center gap-1 tabular-nums">
          {signed(bonus)}
          {kind === "save" && (
            <span
              data-testid="char-sheet-save-prof"
              data-value={ability}
              data-proficient={proficient ? "true" : "false"}
              className={cn(
                "size-1.5 rounded-full",
                proficient ? "bg-foreground" : "bg-transparent",
              )}
            />
          )}
        </span>
      </RollButton>
    </Tooltip>
  );
}

function AbilityCellView({
  c,
  cell,
  overrides,
  clearOverride,
}: {
  c: CharacterRecord;
  cell: AbilityCell;
  overrides: PublicOverrides;
  clearOverride(kind: AbilityRollKind): void;
}) {
  return (
    <div
      data-testid="char-sheet-ability"
      data-value={cell.ability}
      className="flex flex-col gap-1 rounded-md border p-1.5"
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {cell.abbr}
        </span>
        <span className="text-sm tabular-nums">
          <span data-testid="char-sheet-ability-score" data-value={cell.ability}>
            {cell.score}
          </span>{" "}
          <span
            data-testid="char-sheet-ability-mod"
            data-value={cell.ability}
            className="text-muted-foreground"
          >
            ({signed(cell.mod)})
          </span>
        </span>
      </div>
      <AbilityRoll
        c={c}
        kind="check"
        ability={cell.ability}
        bonus={cell.check}
        publicOverride={overrides.check}
        onRolled={() => clearOverride("check")}
      />
      <AbilityRoll
        c={c}
        kind="save"
        ability={cell.ability}
        bonus={cell.save}
        proficient={cell.proficient}
        publicOverride={overrides.save}
        onRolled={() => clearOverride("save")}
      />
    </div>
  );
}

/**
 * FR-CHAR-19/22: "Prof +2" + six cells, or "No ability scores". DM: one public switch per
 * category, preset from the "Ability check" / "Saving throw" setting; a change applies to the
 * next roll of that category, like the shared control's per-roll override (FR-DICE-13).
 */
function AbilitiesBlock({ c }: { c: CharacterRecord }) {
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const live = useSync((s) => s.state === "live");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const [overrides, setOverrides] = useState<PublicOverrides>({});
  const uid = useId();
  const block = abilityBlock(c.statBlock);
  if (!block) {
    return (
      <div className="border-t pt-3">
        <p data-testid="char-sheet-abilities-empty" className="text-sm text-muted-foreground">
          No ability scores
        </p>
      </div>
    );
  }
  const clearOverride = (kind: AbilityRollKind) =>
    setOverrides((o) => {
      const next = { ...o };
      delete next[kind];
      return next;
    });
  const publicSwitch = (kind: AbilityRollKind, label: string) => {
    const preset = settings ? categoryPublic(settings, ABILITY_CATEGORY[kind]) : false;
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Switch
          id={`${uid}-${kind}`}
          data-testid={`char-sheet-public-${kind}`}
          aria-label={`${label} public`}
          checked={overrides[kind] ?? preset}
          disabled={!live}
          onCheckedChange={(v) => setOverrides((o) => ({ ...o, [kind]: v }))}
        />
        <label htmlFor={`${uid}-${kind}`}>{label}</label>
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-testid="char-sheet-prof" className="text-xs font-medium text-muted-foreground">
          Prof {signed(block.proficiency)}
        </span>
        {isDm && (
          <span className="flex items-center gap-2">
            {publicSwitch("check", "Checks")}
            {publicSwitch("save", "Saves")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {block.cells.map((cell) => (
          <AbilityCellView
            key={cell.ability}
            c={c}
            cell={cell}
            overrides={overrides}
            clearOverride={clearOverride}
          />
        ))}
      </div>
    </div>
  );
}

/** FR-CHAR-11: amount 1–999 + Damage / Heal; not undoable. */
function HpControl({ c }: { c: CharacterRecord }) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [raw, setRaw] = useState("");
  const flight = useInFlight();
  const amount = parseHpAmount(raw);
  const disabled = !live || flight.busy || amount === null;
  const send = (sign: 1 | -1) => {
    if (amount === null) return;
    flight.run(() =>
      connection
        .sendIntent(CHAR_ADJUST_HP, { characterId: c.id, delta: sign * amount })
        .then(() => setRaw("")),
    );
  };
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
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
      <p className="text-xs text-muted-foreground">
        Not undoable — in combat the DM applies damage
      </p>
    </div>
  );
}

function Sheet({
  c,
  picker,
  combatBadge,
}: {
  c: CharacterRecord;
  picker: ReactNode;
  combatBadge: string | null;
}) {
  const s = c.statBlock;
  const attack = sheetAttack(s);
  const down = isDown(c.hpCurrent);
  return (
    <Card
      data-testid="char-sheet"
      data-record-id={c.id}
      className="flex h-full flex-col gap-3 overflow-auto border-0 bg-transparent p-1 shadow-none"
    >
      <div className="flex items-start gap-3">
        <Portrait c={c} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span data-testid="char-sheet-name" className="truncate font-semibold">
            {c.name}
          </span>
          <span data-testid="char-sheet-level" className="text-xs text-muted-foreground">
            {levelLine(s.level, s.className)}
          </span>
          {combatBadge && (
            <Badge data-testid="char-sheet-combat" className="w-fit">
              {combatBadge}
            </Badge>
          )}
        </div>
        {picker}
      </div>

      <div className="flex items-end justify-between gap-2">
        <Stat label="AC" testId="char-sheet-ac">
          {s.ac}
        </Stat>
        <div className="flex flex-col items-start">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">HP</span>
          <span className="flex items-center gap-1.5">
            <span
              data-testid="char-sheet-hp"
              data-state={hpState(c.hpCurrent, s.hpMax)}
              className={cn(
                "text-lg font-semibold tabular-nums leading-tight",
                HP_CLASS[hpState(c.hpCurrent, s.hpMax)],
              )}
            >
              {c.hpCurrent} / {s.hpMax}
            </span>
            {down && (
              <Badge data-testid="char-sheet-down" className="bg-hp-down text-white">
                Down
              </Badge>
            )}
          </span>
        </div>
        <Stat label="Speed" testId="char-sheet-speed">
          {speedText(s.speed)}
        </Stat>
        <Stat label="Init" testId="char-sheet-init">
          {signed(s.initBonus)}
        </Stat>
      </div>
      <div className="flex justify-end">
        <RollAction
          c={c}
          kind="initiative"
          label="Initiative"
          testId="char-sheet-roll-init"
          publicTestId="char-sheet-public-init"
        />
      </div>

      {attack && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <span data-testid="char-sheet-attack" className="text-sm">
            {attackLine(attack)}
          </span>
          <div className="flex justify-end">
            <RollAction
              c={c}
              kind="attack"
              label="Attack"
              testId="char-sheet-roll-attack"
              publicTestId="char-sheet-public-attack"
            />
          </div>
        </div>
      )}

      <AbilitiesBlock c={c} />

      <HpControl c={c} />
    </Card>
  );
}

export function CharacterSheet() {
  const you = useSync((s) => s.store.you);
  const store = useSync((s) => s.store);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const eligible = useMemo(
    () =>
      you
        ? (eligibleCharacters(entities, you).filter(
            (e) => e.kind === "character",
          ) as CharacterRecord[])
        : [],
    [entities, you],
  );

  if (!you) {
    return (
      <div className="flex flex-col gap-3 p-1">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const isDm = you.role === "dm";
  const c = selectCharacter(eligible, selectedId);
  if (!c) {
    return (
      <p data-testid="char-sheet-empty" className="p-2 text-sm text-muted-foreground">
        {isDm ? "No characters in this campaign" : "No character yet — ask your DM"}
      </p>
    );
  }
  const ownerName = (id: string) => players.find((p) => p.id === id)?.name;
  const optionLabel = (e: CharacterRecord) => {
    const owner = isDm ? ownerName(e.ownerPlayerId) : undefined;
    return owner ? `${e.name} (${owner})` : e.name;
  };
  const picker =
    eligible.length > 1 ? (
      <select
        data-testid="char-sheet-picker"
        aria-label="Character"
        className={SELECT}
        value={c.id}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        {eligible.map((e) => (
          <option key={e.id} value={e.id}>
            {optionLabel(e)}
          </option>
        ))}
      </select>
    ) : null;
  return (
    <Sheet key={c.id} c={c} picker={picker} combatBadge={sheetBadge(rollRoutes, store, c.id)} />
  );
}
