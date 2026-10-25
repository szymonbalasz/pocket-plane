// DM Initiative row additions (FR-CBTX-33): temp HP "+5" after HP, effect chips on the name line
// (click → Edit / End), PC death pips + state; row menu Conditions ▸, Effect…, Concentration…,
// Temp HP…, Death save / Stabilise for a dying PC, Set death saves…. Rendered by combat's
// `cbt.initiative` row; every control sends an intent, the server decides. Sprint 8 (FR-CBTX-63):
// Move up / Move down.
import { CONDITION_INFO, CONDITIONS, type Condition } from "@shared/combat-extras/conditions";
import { CBTX_INTENTS, type TargetRef } from "@shared/combat-extras/intents";
import type { EffectView } from "@shared/combat-extras/schemas";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { conditionIcon } from "@ui/features/combat-extras/icons";
import {
  activeEffects,
  characterOf,
  countersFor,
  creatureOf,
  deathStateFor,
  effectsOn,
} from "@ui/features/combat-extras/logic";
import { DeathBadge, DeathPips, EffectChips } from "@ui/features/combat-extras/parts";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import {
  manualPartsOf,
  RollButton,
  type RollControl,
  type RollKeys,
  StageHint,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { useTriggerChips } from "@ui/features/effect-modifiers/trigger-badges";
import { useSync } from "@ui/sync/store";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  DicesIcon,
  HeartPulseIcon,
  PencilIcon,
  ShieldPlusIcon,
  SparklesIcon,
  TrashIcon,
  TrophyIcon,
} from "lucide-react";
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ReorderContext } from "../combat-tracker/reorder-drag";
import { rollKeys } from "../combat-tracker/roll-keys";
import { type Target, useCbtxDialogs } from "./store";

/** The row's creature as an intent target. */
export const targetOf = (c: CombatantView): Target => ({
  ref: c.kind === "pc" && c.entityId ? { characterId: c.entityId } : { combatantId: c.id },
  name: c.name,
});

export function useCreatureEffects(c: Pick<CombatantView, "id" | "kind" | "entityId">) {
  const store = useSync((s) => s.store);
  return useMemo(() => effectsOn(activeEffects(store), creatureOf(c)), [store, c]);
}

/** Temp HP "+5" after HP (monsters on the combatant, PCs on the character). */
export function RowTemp({ c }: { c: CombatantView }) {
  const temp = useSync((s) =>
    c.kind === "pc" ? (characterOf(s.store, c.entityId ?? "")?.tempHp ?? 0) : (c.tempHp ?? 0),
  );
  if (!temp) return null;
  return (
    <Tooltip content={`Temp HP ${temp}`}>
      <span
        data-testid="cbtx-init-row-temp"
        data-record-id={c.id}
        data-value={temp}
        className="shrink-0 text-hp-temp"
      >
        +{temp}
      </span>
    </Tooltip>
  );
}

/** Effect chips on the name line (a chip opens Edit… / End), then trigger chips (FR-CBTX-52). */
export function RowEffects({ c, round }: { c: CombatantView; round: number }) {
  const effects = useCreatureEffects(c);
  const triggers = useTriggerChips(c);
  const { send, disabled } = useCbtIntent();
  const openEffect = useCbtxDialogs((s) => s.openEffect);
  const openConcentration = useCbtxDialogs((s) => s.openConcentration);
  return (
    <EffectChips
      compact
      effects={effects}
      triggers={triggers}
      round={round}
      testId="cbtx-init-row-effect"
      // FR-CBTX-60: the concentration chip's menu has the DM's Edit… (today's dialog).
      onEditConcentration={() => openConcentration(targetOf(c))}
      menu={(e: EffectView) => (
        <>
          <DropdownMenuItem
            data-testid="cbtx-init-row-effect-edit"
            data-record-id={e.id}
            onSelect={() => openEffect([targetOf(c)], e.id)}
          >
            <PencilIcon /> Edit…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-testid="cbtx-init-row-effect-end"
            data-record-id={e.id}
            disabled={disabled}
            onSelect={() => void send(CBTX_INTENTS.endEffect, { effectId: e.id })}
          >
            <TrashIcon /> End
          </DropdownMenuItem>
        </>
      )}
    />
  );
}

/** PC death pips + state Badge (FR-CBTX-33). */
export function RowDeath({ c }: { c: CombatantView }) {
  const ch = useSync((s) => (c.entityId ? characterOf(s.store, c.entityId) : undefined));
  if (c.kind !== "pc") return null;
  const state = deathStateFor(ch);
  const counters = countersFor(ch);
  if (!state) return null;
  return (
    <>
      {counters && <DeathPips c={counters} />}
      <DeathBadge state={state} testId="cbtx-init-row-death" />
    </>
  );
}

/** FR-CBTX-25: a dead PC is muted with the skip icon, like a monster at 0. */
export function useDeadPc(c: CombatantView): boolean {
  return useSync(
    (s) => c.kind === "pc" && deathStateFor(characterOf(s.store, c.entityId ?? "")) === "dead",
  );
}

/** The death save roll control of a dying PC's row (anchor rendered by the row). */
export function useDeathSaveRoll(c: CombatantView): RollControl {
  const { send } = useCbtIntent();
  return useRollControl({
    expressions: ["1d20"],
    category: "saving-throw",
    label: `${c.name} — Death save`,
    // FR-MOD-15, -27: a death save is a save with no ability.
    ...(c.entityId ? { subject: { creature: { characterId: c.entityId }, roll: "save" } } : {}),
    onRoll: (r) =>
      void send(CBTX_INTENTS.rollDeathSave, {
        characterId: c.entityId,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...manualPartsOf(r),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
}

/** Invisible anchor for the death save's physical-dice popover (the menu item shows the Alt hint). */
export function DeathSaveAnchor({ control }: { control: RollControl }) {
  return (
    <RollButton
      control={control}
      hint={false}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none size-0 overflow-hidden p-0 opacity-0"
    />
  );
}

/** Close delay of a submenu, ms: long enough to cross from the trigger to an item. */
const SUB_CLOSE_DELAY = 300;

/**
 * A hover-safe submenu (as combat's Check ▸ / Save ▸): near the screen's right edge the submenu
 * flips left and Radix closes it when the pointer leaves the trigger in another direction than
 * its last move, so a mouse click on an item never landed. A close waits `SUB_CLOSE_DELAY`;
 * entering the submenu keeps it open; opening is immediate.
 */
function SafeSub({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <DropdownMenuSub
      open={open}
      onOpenChange={(next) => {
        clearTimeout(timer.current);
        if (next) setOpen(true);
        else timer.current = setTimeout(() => setOpen(false), SUB_CLOSE_DELAY);
      }}
    >
      {trigger}
      <DropdownMenuSubContent
        className="max-h-[70vh] overflow-y-auto"
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerMove={() => clearTimeout(timer.current)}
      >
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * FR-CBTX-35 / -33: Conditions ▸ — 15 toggles over `targets` (checked when all have it; toggling
 * on adds to all, off ends each one's); exhaustion has a level submenu. `omit`: conditions left
 * out (the token menu's Invisible, FR-CBTX-56).
 */
export function ConditionsMenu({
  targets,
  testId,
  omit = [],
}: {
  targets: { target: Target; effects: EffectView[] }[];
  testId: string;
  omit?: readonly Condition[];
}) {
  const { send, disabled } = useCbtIntent();
  const has = (k: Condition) =>
    targets.map((t) => t.effects.find((e) => e.kind === "condition" && e.condition === k));
  const toggle = async (k: Condition, level?: number) => {
    const found = has(k);
    if (level === undefined && found.every(Boolean)) {
      for (const e of found) if (e) await send(CBTX_INTENTS.endEffect, { effectId: e.id });
      return;
    }
    await send(CBTX_INTENTS.addEffect, {
      targets: targets.map((t) => t.target.ref) as TargetRef[],
      kind: "condition",
      condition: k,
      ...(level !== undefined ? { level } : {}),
    });
  };
  return (
    <SafeSub
      trigger={
        <DropdownMenuSubTrigger data-testid={testId}>
          <SparklesIcon /> Conditions
        </DropdownMenuSubTrigger>
      }
    >
      {CONDITIONS.filter((k) => !omit.includes(k)).map((k) => {
        const Icon = conditionIcon(k);
        const all = has(k).every(Boolean);
        if (k === "exhaustion") {
          const lvl = has(k)[0]?.level ?? null;
          return (
            <SafeSub
              key={k}
              trigger={
                <DropdownMenuSubTrigger
                  data-testid={`${testId}-option`}
                  data-value={k}
                  data-checked={all}
                >
                  <Icon /> {CONDITION_INFO[k].name}
                  {lvl !== null && <span className="ml-auto text-xs">{lvl}</span>}
                </DropdownMenuSubTrigger>
              }
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <DropdownMenuItem
                  key={n}
                  data-testid={`${testId}-level`}
                  data-value={n}
                  disabled={disabled}
                  onSelect={() => void toggle(k, n)}
                >
                  Level {n} {lvl === n && <CheckIcon className="ml-auto" />}
                </DropdownMenuItem>
              ))}
              {has(k).some(Boolean) && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={disabled}
                  onSelect={async () => {
                    for (const e of has(k)) {
                      if (e) await send(CBTX_INTENTS.endEffect, { effectId: e.id });
                    }
                  }}
                >
                  <TrashIcon /> Remove
                </DropdownMenuItem>
              )}
            </SafeSub>
          );
        }
        return (
          <DropdownMenuItem
            key={k}
            data-testid={`${testId}-option`}
            data-value={k}
            data-checked={all}
            disabled={disabled}
            onSelect={() => void toggle(k)}
          >
            <Icon /> {CONDITION_INFO[k].name}
            {all && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        );
      })}
    </SafeSub>
  );
}

/**
 * FR-CBTX-63: Move up / Move down, one block per step (`cbtx.moveCombatant`, as a drag); disabled
 * at the ends, on a row riding its owner, while a move is in flight or not live.
 */
export function RowMoveItems({ c }: { c: CombatantView }) {
  const r = useContext(ReorderContext);
  if (!r) return null;
  const up = r.step(c.id, "up");
  const down = r.step(c.id, "down");
  return (
    <>
      <DropdownMenuItem
        data-testid="cbtx-init-row-move-up"
        data-record-id={c.id}
        disabled={!up}
        onSelect={() => up?.()}
      >
        <ArrowUpIcon /> Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid="cbtx-init-row-move-down"
        data-record-id={c.id}
        disabled={!down}
        onSelect={() => down?.()}
      >
        <ArrowDownIcon /> Move down
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

/** Row menu entries (before combat's Damage / heal…). */
export function RowMenuItems({ c, deathRoll }: { c: CombatantView; deathRoll: RollControl }) {
  const effects = useCreatureEffects(c);
  const { send, disabled } = useCbtIntent();
  const d = useCbtxDialogs();
  const ch = useSync((s) => (c.entityId ? characterOf(s.store, c.entityId) : undefined));
  const state = c.kind === "pc" ? deathStateFor(ch) : null;
  const keys = useRef<RollKeys>({});
  const t = targetOf(c);
  return (
    <>
      <ConditionsMenu targets={[{ target: t, effects }]} testId="cbtx-init-row-conditions" />
      <DropdownMenuItem data-testid="cbtx-init-row-effect-new" onSelect={() => d.openEffect([t])}>
        <ShieldPlusIcon /> Effect…
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid="cbtx-init-row-concentration"
        onSelect={() => d.openConcentration(t)}
      >
        <BrainIcon /> Concentration…
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="cbtx-init-row-temp-set" onSelect={() => d.openTemp([t])}>
        <HeartPulseIcon /> Temp HP…
      </DropdownMenuItem>
      {state === "dying" && (
        <>
          <DropdownMenuItem
            data-testid="cbtx-init-row-death-roll"
            onPointerDown={(e) => {
              keys.current = rollKeys(e);
            }}
            onSelect={() => {
              deathRoll.roll(keys.current);
              keys.current = {};
            }}
          >
            <DicesIcon />
            <span className="flex flex-col">
              Death save
              {/* FR-DICEX-51: the item rolls through an invisible anchor, so it shows the hint. */}
              <span className="text-xs text-muted-foreground">
                <StageHint />
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="cbtx-init-row-stabilise"
            disabled={disabled}
            onSelect={() =>
              void send(CBTX_INTENTS.setDeathSaves, {
                characterId: c.entityId,
                successes: 3,
                failures: ch?.deathFailures ?? 0,
              })
            }
          >
            <TrophyIcon /> Stabilise
          </DropdownMenuItem>
        </>
      )}
      {state !== null && c.entityId && (
        <DropdownMenuItem
          data-testid="cbtx-init-row-death-set"
          onSelect={() => d.openDeathSet(c.entityId as string, c.name)}
        >
          <PencilIcon /> Set death saves…
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
    </>
  );
}
