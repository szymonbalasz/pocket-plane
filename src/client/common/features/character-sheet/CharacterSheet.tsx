// Window `char.sheet` body, both clients (CHAR §7). A view over the `entity` record of kind
// `character` (FR-CHAR-01); every change goes out as an intent (`char.roll`, `char.adjustHp`, or a
// claimed roll route, FR-CHAR-16). DM-only parts (owner names, public switches) from `you.role`.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
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
} from "@shared/character-sheet/logic";
import { CHAR_ADJUST_HP, type CharRollKind } from "@shared/character-sheet/schemas";
import { type CharacterRecord, ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/controls";
import { Badge, Card, Input, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import { rollRoutes } from "./roll-routes";
import { createInFlight, intentErrorText, routeFor, sendSheetRoll } from "./routing";

const SELECT =
  "h-8 min-w-0 max-w-36 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const HP_CLASS = { full: "text-hp-full", bloodied: "text-hp-bloodied", down: "text-hp-down" };

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
  kind: CharRollKind;
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
      <RollButton
        control={control}
        data-testid={testId}
        type="button"
        size="sm"
        variant="secondary"
        title="Shift: advantage · Ctrl: disadvantage"
        disabled={!live || flight.busy || specs.length === 0}
      >
        {label}
      </RollButton>
      {control.error && <span className="text-xs text-destructive">{control.error}</span>}
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
  const claim =
    routeFor(rollRoutes, store, c.id, "initiative") ?? routeFor(rollRoutes, store, c.id, "attack");
  return <Sheet key={c.id} c={c} picker={picker} combatBadge={claim?.badge ?? null} />;
}
