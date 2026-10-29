// combat-extras' character sheet sections (FR-CBTX-41, CBTX §7.1): `cbtx.temp-hp` (hp, K11),
// `cbtx.death-saves` (vitals, while `deathState != null`), `cbtx.effects` (header). Both clients,
// characters only. They read only the store and send only CBTX intents; registered in
// character-sheet-full's `sheetSections` registry (D/S seam). Also `EffectsLine`, the read-only
// chips for reminders' character groups (FR-CBTX-70).
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { DEATH_SAVES_MAX } from "@shared/combat-extras/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { BrainIcon, DicesIcon, EllipsisIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import type { SheetSection } from "../character-sheet/sections";
import { useCbtIntent, useStartedEncounter } from "../combat-tracker/store";
import { manualPartsOf, RollButton, useRollControl } from "../dice-roll-log/roll-control";
import { useEffectFxDialog } from "../spell-fx/EffectFx";
import {
  activeEffects,
  characterOf,
  chipOrder,
  countersFor,
  deathStateFor,
  effectsOn,
  roundsLeftText,
} from "./logic";
import { DeathBadge, EffectChip, EffectChips } from "./parts";

export interface SectionProps {
  creatureId: string;
  client: "dm" | "player";
}

/** Owner or DM: who may set temp HP, roll death saves and concentrate (OQ-CBTX-07). */
function useMayAct(creatureId: string): boolean {
  return useSync((s) => {
    const you = s.store.you;
    if (you?.role === "dm") return true;
    return characterOf(s.store, creatureId)?.ownerPlayerId === you?.playerId;
  });
}

/** The temp HP rule, in the trigger's Tooltip (K11: no sentence under the control). */
export const TEMP_HP_HINT = "Temp HP is lost first · doesn't stack — keep the higher";

/**
 * `cbtx.temp-hp` (FR-CBTX-14), slot `hp`: the sheet's Hit Points box shows "Temp N"; this lays a
 * transparent button over that column (owner, DM) that opens a small popover: number + Set
 * (K11, kit parity: the control left its own row). Others: nothing (the box shows the value).
 */
export function TempHpSection({ creatureId }: SectionProps) {
  const temp = useSync((s) => characterOf(s.store, creatureId)?.tempHp);
  const may = useMayAct(creatureId);
  const { send, disabled } = useCbtIntent();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  if (temp === undefined || !may) return null;
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 999;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={TEMP_HP_HINT}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="cbtx-temp-open"
            aria-label={`Temp HP ${temp}: set`}
            className="absolute inset-0 rounded-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent data-testid="cbtx-sheet-temp" align="end" className="w-auto p-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            const r = await send(CBTX_INTENTS.setTempHp, {
              target: { characterId: creatureId },
              value: n,
            });
            if (r !== undefined) {
              setValue("");
              setOpen(false);
            }
          }}
        >
          <span className="text-sm text-muted-foreground">Temp HP</span>
          <span
            data-testid="cbtx-temp-value"
            data-value={temp}
            className="text-sm font-medium tabular-nums"
          >
            {temp}
          </span>
          <Input
            data-testid="cbtx-temp-input"
            aria-label="Temp HP"
            inputMode="numeric"
            className="h-7 w-16"
            placeholder={String(temp)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            data-testid="cbtx-temp-save"
            className="h-7"
            disabled={disabled || !valid}
          >
            Set
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export const deathSavesAvailable = (store: RecordStore, creatureId: string) =>
  deathStateFor(characterOf(store, creatureId)) !== null;

function Pips({ n, kind }: { n: number; kind: "success" | "failure" }) {
  return (
    <span
      data-testid={`cbtx-death-${kind}`}
      data-value={n}
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${n} ${kind === "success" ? "successes" : "failures"}`}
    >
      {Array.from({ length: DEATH_SAVES_MAX }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed pip positions
          key={i}
          className={cn(
            "size-3 rounded-full border",
            i < n &&
              (kind === "success" ? "border-hp-full bg-hp-full" : "border-hp-down bg-hp-down"),
          )}
        />
      ))}
    </span>
  );
}

/** `cbtx.death-saves`: pips, state, Death save roll; DM Stabilise + Set (FR-CBTX-23/24). */
export function DeathSavesSection({ creatureId }: SectionProps) {
  const ch = useSync((s) => characterOf(s.store, creatureId));
  const may = useMayAct(creatureId);
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const { send, disabled } = useCbtIntent();
  const control = useRollControl({
    expressions: ["1d20"],
    category: "saving-throw",
    label: `${ch?.name ?? ""} — Death save`,
    // FR-MOD-15, -27: a death save is a save with no ability.
    subject: { creature: { characterId: creatureId }, roll: "save" },
    onRoll: (r) =>
      void send(CBTX_INTENTS.rollDeathSave, {
        characterId: creatureId,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...manualPartsOf(r),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
  const state = deathStateFor(ch);
  const counters = countersFor(ch);
  if (!state) return null;
  const set = (successes: number, failures: number) =>
    void send(CBTX_INTENTS.setDeathSaves, { characterId: creatureId, successes, failures });
  return (
    <div data-testid="cbtx-sheet-death" className="flex flex-wrap items-center gap-2 text-sm">
      {/* K11: a group of the sheet's vitals line, labelled as the kit ("Death Saves ○○○ ○○○"). */}
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Death Saves
      </span>
      <DeathBadge state={state} testId="cbtx-death-state" />
      {counters && (
        <>
          <Pips n={counters.successes} kind="success" />
          <Pips n={counters.failures} kind="failure" />
        </>
      )}
      {may && state === "dying" && (
        <RollButton
          control={control}
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          data-testid="cbtx-death-roll"
          disabled={disabled}
        >
          <DicesIcon className="size-3.5" /> Death save
        </RollButton>
      )}
      {isDm && counters && (
        <DropdownMenu>
          <Tip content="Death saves">
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Death saves">
                <EllipsisIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid="cbtx-death-stabilise"
              disabled={disabled}
              onSelect={() => set(DEATH_SAVES_MAX, counters.failures)}
            >
              Stabilise
            </DropdownMenuItem>
            {[0, 1, 2, 3].map((f) => (
              <DropdownMenuItem
                key={f}
                data-testid="cbtx-death-set-failures"
                data-value={f}
                disabled={disabled}
                onSelect={() => set(counters.successes, f)}
              >
                Failures: {f}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** `cbtx.effects`: chips of the character's active effects; Concentrate… / End concentration. */
export function EffectsSection({ creatureId }: SectionProps) {
  const store = useSync((s) => s.store);
  const enc = useStartedEncounter();
  const may = useMayAct(creatureId);
  const isDm = store.you?.role === "dm";
  const { send, disabled } = useCbtIntent();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState("");
  const effects = effectsOn(activeEffects(store), { characterId: creatureId });
  const conc = effects.find((e) => e.kind === "concentration");
  // FR-VFX-10: Map effect… on each chip's menu (DM; the owner on their own character's effects).
  const fx = useEffectFxDialog();
  const rounds = duration.trim() === "" ? null : Number(duration);
  const valid =
    label.trim().length >= 1 &&
    (rounds === null || (Number.isInteger(rounds) && rounds >= 1 && rounds <= 100 && !!enc));
  return (
    <div data-testid="cbtx-sheet-effects" className="flex min-w-0 items-center gap-1">
      <EffectChips
        effects={effects}
        round={enc?.round ?? null}
        testId="cbtx-sheet-effect"
        menu={
          isDm || may
            ? (e) => (
                <>
                  {isDm && (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={disabled}
                      onSelect={() => void send(CBTX_INTENTS.endEffect, { effectId: e.id })}
                    >
                      <TrashIcon /> End
                      {roundsLeftText(e, enc?.round ?? null)
                        ? ` (${roundsLeftText(e, enc?.round ?? null)})`
                        : ""}
                    </DropdownMenuItem>
                  )}
                  {fx.item(e)}
                </>
              )
            : undefined
        }
      />
      {fx.dialog}
      {may && (
        <>
          <DropdownMenu>
            <Tip content="Effects">
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  data-testid="cbtx-sheet-effects-menu"
                  aria-label="Effects"
                >
                  <BrainIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end">
              {/* A Dialog, not a popover: the menu's focus return would dismiss a popover at once. */}
              <DropdownMenuItem data-testid="cbtx-sheet-concentrate" onSelect={() => setOpen(true)}>
                <BrainIcon /> Concentrate…
              </DropdownMenuItem>
              {conc && (
                <DropdownMenuItem
                  variant="destructive"
                  data-testid="cbtx-sheet-end-concentration"
                  disabled={disabled}
                  onSelect={() => void send(CBTX_INTENTS.endEffect, { effectId: conc.id })}
                >
                  <TrashIcon /> End concentration ({conc.label})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent data-testid="cbtx-sheet-conc-dialog" className="sm:max-w-xs">
              <DialogHeader>
                <DialogTitle>Concentrate</DialogTitle>
                <DialogDescription>Replaces any concentration this character has</DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!valid) return;
                  const r = await send(CBTX_INTENTS.setConcentration, {
                    target: { characterId: creatureId },
                    label: label.trim(),
                    ...(rounds !== null ? { durationRounds: rounds } : {}),
                  });
                  if (r !== undefined) {
                    setOpen(false);
                    setLabel("");
                    setDuration("");
                  }
                }}
              >
                <Label htmlFor="cbtx-conc-label-sheet">Spell</Label>
                <Input
                  id="cbtx-conc-label-sheet"
                  data-testid="cbtx-conc-label"
                  maxLength={40}
                  autoFocus
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Label htmlFor="cbtx-conc-duration-sheet">Duration (rounds)</Label>
                <Input
                  id="cbtx-conc-duration-sheet"
                  data-testid="cbtx-conc-duration"
                  inputMode="numeric"
                  placeholder="Until removed"
                  disabled={!enc}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  data-testid="cbtx-conc-save"
                  disabled={disabled || !valid}
                >
                  Concentrate
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/**
 * FR-CBTX-70: the character's active effects as `cbtx.effects`' chips (icons, labels, exhaustion
 * level, "3r" when timed, concentration's label), read-only: no menus, Concentrate… or clicks.
 * Only what the viewer already receives (FR-CBTX-31); chips wrap, none fold. None → nothing.
 */
export function EffectsLine({
  characterId,
  testId = "cbtx-effects-line",
}: {
  characterId: string;
  /** The line's test ID (`data-record-id` = the character); reminders pass `rem-effects`. */
  testId?: string;
}) {
  const store = useSync((s) => s.store);
  const enc = useStartedEncounter();
  const effects = chipOrder(effectsOn(activeEffects(store), { characterId }));
  if (effects.length === 0) return null;
  return (
    <div
      data-testid={testId}
      data-record-id={characterId}
      className="flex min-w-0 flex-wrap items-center gap-0.5"
    >
      {effects.map((e) => (
        <EffectChip
          key={e.id}
          e={e}
          round={enc?.round ?? null}
          testId="cbtx-effect-chip"
          className="max-w-full"
        />
      ))}
    </div>
  );
}

/** The three registry entries (FR-CBTX-41); not locked by the sheet lock (play state). */
export const cbtxTempHpSection: SheetSection = {
  id: "cbtx.temp-hp",
  // K11 (kit parity): over the Hit Points box's Temp column, not a vitals row.
  slot: "hp",
  order: 50,
  kinds: ["character"],
  component: TempHpSection,
};
export const cbtxDeathSavesSection: SheetSection = {
  id: "cbtx.death-saves",
  slot: "vitals",
  order: 60,
  kinds: ["character"],
  available: deathSavesAvailable,
  component: DeathSavesSection,
};
export const cbtxEffectsSection: SheetSection = {
  id: "cbtx.effects",
  slot: "header",
  order: 50,
  kinds: ["character"],
  component: EffectsSection,
};
