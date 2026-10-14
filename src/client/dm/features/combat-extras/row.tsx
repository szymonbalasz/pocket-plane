// DM Initiative row additions (FR-CBTX-33): temp HP "+5" after HP, effect chips on the name line
// (click → Edit / End), PC death pips + state; row menu Conditions ▸, Effect…, Concentration…,
// Temp HP…, Death save / Stabilise for a dying PC, Set death saves…. Rendered by combat's
// `cbt.initiative` row; every control sends an intent, the server decides.
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
  RollButton,
  type RollControl,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { useSync } from "@ui/sync/store";
import {
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
import { useMemo, useRef } from "react";
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
        className="shrink-0 text-sky-400"
      >
        +{temp}
      </span>
    </Tooltip>
  );
}

/** Effect chips on the name line; a chip opens Edit… / End. */
export function RowEffects({ c, round }: { c: CombatantView; round: number }) {
  const effects = useCreatureEffects(c);
  const { send, disabled } = useCbtIntent();
  const openEffect = useCbtxDialogs((s) => s.openEffect);
  return (
    <EffectChips
      effects={effects}
      round={round}
      testId="cbtx-init-row-effect"
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
    onRoll: (r) =>
      void send(CBTX_INTENTS.rollDeathSave, {
        characterId: c.entityId,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...(r.public !== undefined ? { public: r.public } : {}),
      }),
  });
}

/** Invisible anchor for the death save's physical-dice popover. */
export function DeathSaveAnchor({ control }: { control: RollControl }) {
  return (
    <RollButton
      control={control}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none size-0 overflow-hidden p-0 opacity-0"
    />
  );
}

/**
 * FR-CBTX-35 / -33: Conditions ▸ — 15 toggles over `targets` (checked when all have it; toggling
 * on adds to all, off ends each one's); exhaustion has a level submenu.
 */
export function ConditionsMenu({
  targets,
  testId,
}: {
  targets: { target: Target; effects: EffectView[] }[];
  testId: string;
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
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={testId}>
        <SparklesIcon /> Conditions
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[70vh] overflow-y-auto">
        {CONDITIONS.map((k) => {
          const Icon = conditionIcon(k);
          const all = has(k).every(Boolean);
          if (k === "exhaustion") {
            const lvl = has(k)[0]?.level ?? null;
            return (
              <DropdownMenuSub key={k}>
                <DropdownMenuSubTrigger
                  data-testid={`${testId}-option`}
                  data-value={k}
                  data-checked={all}
                >
                  <Icon /> {CONDITION_INFO[k].name}
                  {lvl !== null && <span className="ml-auto text-xs">{lvl}</span>}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
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
                </DropdownMenuSubContent>
              </DropdownMenuSub>
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Row menu entries (before combat's Damage / heal…). */
export function RowMenuItems({ c, deathRoll }: { c: CombatantView; deathRoll: RollControl }) {
  const effects = useCreatureEffects(c);
  const { send, disabled } = useCbtIntent();
  const d = useCbtxDialogs();
  const ch = useSync((s) => (c.entityId ? characterOf(s.store, c.entityId) : undefined));
  const state = c.kind === "pc" ? deathStateFor(ch) : null;
  const keys = useRef<{ shiftKey?: boolean; ctrlKey?: boolean }>({});
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
              keys.current = { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey };
            }}
            onSelect={() => {
              deathRoll.roll(keys.current);
              keys.current = {};
            }}
          >
            <DicesIcon /> Death save
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
