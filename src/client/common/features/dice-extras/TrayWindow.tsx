// Window `dicex.tray` body (FR-DICEX-01–10; DICEX §7): the roll control's second face. `free`
// requests are composed here and sent as `dice.roll`; `control` requests (Alt+click) roll through
// the caller's own `onRoll`, so the caller sends its own intent. One `RollControl` per host: the
// tray runs `useRollControl` on the staged options, so physical dice show the same `ManualForm`.

import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { throwDice } from "@shared/dice-extras/throw";
import { prepareExpression } from "@shared/dice-roll-log/grammar";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  CATEGORY_LABEL,
  type DiceRollIntent,
  type DmRollActorRef,
  type GameLogEntryView,
  ROLL_CATEGORIES,
  type RollCategory,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { SCENE_TYPE, type SceneView, TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import { actorOptions, actorSelection, modeFromKeys } from "../dice-roll-log/logic";
import {
  ManualForm,
  type RollControlOptions,
  type RollRequest,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { FlatDie } from "./FlatDie";
import { useThreeD } from "./lazy3d";
import { useDiceSettings } from "./settings";
import { diceExtras, type TrayRequest, useDiceExtras } from "./store";
import { trayExtras } from "./tray-extras";
import {
  addDie,
  chipsOf,
  constantOfTerms,
  notationOf,
  PALETTE,
  previewMode,
  removeDie,
  setConstant,
  type TrayChip,
  termsOf,
} from "./tray-logic";

export type TrayState = "idle" | "compose" | "adjust" | "manual" | "rolling" | "result";

const SELECT =
  "h-7 min-w-0 shrink-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const MODE_LABEL: Record<RollMode, string> = {
  disadvantage: "Dis",
  normal: "Normal",
  advantage: "Adv",
};

const IDLE_TEXT = "Click dice in any text, Alt+click a roll button, or pick dice below";

/** FR-DICEX-03 / DICEX §7: the tray's state from what is staged and in flight. */
export function trayState(o: {
  request: TrayRequest | null;
  rolling: boolean;
  result: unknown | null;
  manual: boolean;
}): TrayState {
  if (o.rolling) return "rolling";
  if (o.result) return "result";
  if (o.manual) return "manual";
  if (!o.request) return "idle";
  return o.request.kind === "free" ? "compose" : "adjust";
}

function errorText(err: unknown): string {
  if (err instanceof IntentRejected) {
    const issue = (err.issues as { message?: string }[] | undefined)?.[0]?.message;
    return issue ?? err.message;
  }
  return err instanceof Error ? err.message : "Roll failed";
}

const NO_ROLL: RollControlOptions = { expressions: [], category: "other", onRoll: () => {} };

/**
 * The options of the tray's one `RollControl`. `control`: the caller's options **verbatim** with
 * the tray's mode; Roll calls the caller's `onRoll` with the very `RollRequest` an immediate roll
 * would get, so the caller sends its own intent (FR-DICEX-05, -08 a, d). `free`: a `dice.roll`
 * of the composed expression (FR-DICEX-04). Either marks the tray `rolling` (FR-DICEX-09).
 */
export function trayControlOptions(
  request: TrayRequest | null,
  draft: string,
  mode: RollMode,
  sendFree: (r: RollRequest) => void,
): RollControlOptions {
  if (request?.kind === "control") {
    const { onRoll } = request.options;
    return {
      ...request.options,
      mode,
      onRoll: (r) => {
        diceExtras.sent(true);
        onRoll(r);
      },
    };
  }
  if (request?.kind === "free") {
    return {
      expressions: [draft.trim()],
      category: request.category,
      label: request.label ?? CATEGORY_LABEL[request.category],
      mode,
      onRoll: (r) => {
        diceExtras.sent(true);
        sendFree(r);
      },
    };
  }
  return NO_ROLL;
}

/** Shift / Ctrl held while the tray has focus or the pointer: previews adv / dis (FR-DICEX-08 e). */
const heldOf = (e: { shiftKey: boolean; ctrlKey: boolean }): RollMode | null => {
  const m = modeFromKeys(e, "normal");
  return m === "normal" ? null : m;
};

function useHeldMode(): [RollMode | null, (e: { shiftKey: boolean; ctrlKey: boolean }) => void] {
  const [held, setHeld] = useState<RollMode | null>(null);
  const track = (e: { shiftKey: boolean; ctrlKey: boolean }) => setHeld(heldOf(e));
  useEffect(() => {
    const up = (e: globalThis.KeyboardEvent) => setHeld(heldOf(e));
    const blur = () => setHeld(null);
    globalThis.addEventListener?.("keyup", up);
    globalThis.addEventListener?.("blur", blur);
    return () => {
      globalThis.removeEventListener?.("keyup", up);
      globalThis.removeEventListener?.("blur", blur);
    };
  }, []);
  return [held, track];
}

/** A die chip; `onRemove` makes it a button (compose: removes one die of its term). */
function Chip({ chip, onRemove }: { chip: TrayChip; onRemove?: () => void }) {
  const text = `${chip.sign === -1 ? "−" : ""}d${chip.faces}`;
  const cls = cn(
    "relative flex h-8 min-w-9 items-center justify-center rounded-md border bg-secondary px-1.5 font-mono text-xs",
    chip.tag && "border-primary",
  );
  const body = (
    <>
      {text}
      {chip.tag && (
        <span className="absolute -top-1.5 -right-1.5 rounded bg-primary px-1 text-[9px] leading-tight text-primary-foreground">
          {chip.tag}
        </span>
      )}
    </>
  );
  const attrs = {
    "data-testid": "dicex-tray-die",
    "data-faces": chip.faces,
    "data-term": chip.term,
    ...(chip.tag && { "data-tag": chip.tag }),
  };
  return onRemove ? (
    <button
      type="button"
      {...attrs}
      aria-label={`Remove one ${text}`}
      className={cn(cls, "hover:border-destructive hover:line-through")}
      onClick={onRemove}
    >
      {body}
    </button>
  ) : (
    <span {...attrs} className={cls}>
      {body}
    </span>
  );
}

/** FR-DICEX-08 b: one registry entry's labelled read-only chips (its hook runs every render). */
function ExtraChips({
  extra,
  request,
  mode,
}: {
  extra: (typeof trayExtras)[number];
  request: TrayRequest;
  mode: RollMode;
}) {
  const dice = extra.useDice(request, mode);
  if (dice.length === 0) return null;
  return (
    <span
      data-testid="dicex-tray-extra"
      data-value={extra.key}
      className="flex flex-wrap items-center gap-1"
    >
      {dice.map((d, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: positional per render
          key={i}
          className="flex h-8 items-center rounded-md border border-dashed px-1.5 font-mono text-xs text-muted-foreground"
        >
          {d.label} {d.sign === -1 ? "−" : "+"}
          {d.count}d{d.faces}
        </span>
      ))}
    </span>
  );
}

function Extras({ request, mode }: { request: TrayRequest; mode: RollMode }) {
  const sorted = useMemo(() => [...trayExtras].sort((a, b) => a.order - b.order), []);
  return (
    <>
      {sorted.map((x) => (
        <ExtraChips key={x.key} extra={x} request={request} mode={mode} />
      ))}
    </>
  );
}

const signed = (n: number) => (n === 0 ? "" : n > 0 ? `+${n}` : `−${-n}`);

/** FR-DICEX-21 / DICEX §7: render 3D / Flat / Off, "Show others' rolls", "Dice look…". */
function SettingsPopover() {
  const { settings, set } = useDiceSettings();
  const threeD = useThreeD();
  const shown = settings.render === "3d" && !threeD.available ? "flat" : settings.render;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          data-testid="dicex-settings-open"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label="Dice settings"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="flex w-64 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Dice on this device</p>
          <ToggleGroup
            type="single"
            aria-label="Dice rendering"
            value={shown}
            onValueChange={(v) => {
              if (v) set({ render: v as "3d" | "flat" | "off" });
            }}
          >
            {(["3d", "flat", "off"] as const).map((r) => (
              <ToggleGroupItem
                key={r}
                value={r}
                data-testid="dicex-settings-render"
                data-value={r}
                disabled={r === "3d" && !threeD.available}
                className="h-7 px-3"
              >
                {r === "3d" ? "3D" : r === "flat" ? "Flat" : "Off"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {threeD.reason && (
            <p data-testid="dicex-settings-3d-hint" className="text-xs text-muted-foreground">
              {threeD.reason === "no-webgl"
                ? "3D unavailable on this device"
                : "3D dice couldn't load: dice show flat this session."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id="dicex-settings-others"
            data-testid="dicex-settings-others"
            checked={settings.others}
            onCheckedChange={(v) => set({ others: v })}
          />
          <label htmlFor="dicex-settings-others">Show others' rolls</label>
        </div>
        <Button data-testid="dicex-look-open" size="sm" variant="outline" disabled>
          Dice look…
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** `result`: the last own roll as flat dice, its total and the log line (FR-DICEX-10). */
function ResultView({ entries }: { entries: GameLogEntryView[] }) {
  const t = useMemo(() => throwDice(entries), [entries]);
  const lines = useMemo(
    () =>
      entries.map((e) =>
        formatEntry(e)
          .segments.map((s) => s.text)
          .join(""),
      ),
    [entries],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {t?.dice.map((d) => (
          <FlatDie key={d.key} die={d} size="sm" />
        ))}
        {t && t.more > 0 && <span className="text-xs text-muted-foreground">+{t.more} more</span>}
        {t && t.totals.length > 0 && (
          <strong data-testid="dicex-tray-total" className="ml-1 text-lg">
            {t.totals.join(" · ")}
          </strong>
        )}
      </div>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one line per entry, positional
        <p key={i} data-testid="dicex-tray-line" className="text-xs text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

/** Actor Select for `free` requests (FR-DICE-27, -34). */
function useActors() {
  const you = useSync((s) => s.store.you);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const scenes = useRecords<SceneView>(SCENE_TYPE);
  const tokens = useRecords<TokenView>(TOKEN_TYPE);
  const encounters = useRecords<EncounterRecord>(ENCOUNTER_TYPE);
  const combatants = useRecords<CombatantRecord>(COMBATANT_TYPE);
  return useMemo(
    () => actorOptions(you, entities, scenes, tokens, encounters, combatants),
    [you, entities, scenes, tokens, encounters, combatants],
  );
}

const refKey = (ref: DmRollActorRef | undefined) => (ref ? JSON.stringify(ref) : "");

export function TrayWindow() {
  const request = useDiceExtras((s) => s.request);
  const staged = useDiceExtras((s) => s.staged);
  const rolling = useDiceExtras((s) => s.rolling);
  const result = useDiceExtras((s) => s.result);
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const actors = useActors();
  const mode = useDiceExtras((s) => s.mode);
  const [held, trackKeys] = useHeldMode();
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const free = request?.kind === "free" ? request : null;
  const [draft, setDraft] = useState(free?.expression ?? "");
  const lastValid = useRef(termsOf(draft) ?? []);

  // A new stage resets the draft to the request's (FR-DICEX-02); the store resets the mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per stage (`staged`)
  useEffect(() => {
    const r = diceExtras.api.getState().request;
    setError(null);
    if (r?.kind === "free") {
      setDraft(r.expression);
      lastValid.current = termsOf(r.expression) ?? [];
    }
  }, [staged]);

  const update = (patch: Partial<Extract<TrayRequest, { kind: "free" }>>) => {
    const base = free ?? {
      kind: "free" as const,
      expression: "",
      mode,
      category: "other" as const,
    };
    diceExtras.api.setState({ request: { ...base, ...patch }, result: null });
  };
  const setTerms = (terms: ReturnType<typeof addDie>) => {
    const expression = notationOf(terms);
    lastValid.current = terms;
    setDraft(expression);
    setError(null);
    update({ expression });
  };

  // One RollControl for the staged request: `control` options verbatim (FR-DICEX-08 a) with the
  // tray's mode; `free` → a `dice.roll` built here (FR-DICEX-04).
  const sendFree = (r: RollRequest) => {
    if (!free) return;
    const intent: DiceRollIntent = {
      expression: draft.trim(),
      mode: r.mode,
      category: free.category,
    };
    if (free.label) intent.label = free.label;
    if (free.actor) intent.actor = free.actor;
    if (r.manual?.[0]) intent.manual = r.manual[0];
    if (r.public !== undefined) intent.public = r.public;
    connection.sendIntent("dice.roll", intent).catch((err: unknown) => {
      diceExtras.failed();
      setError(errorText(err));
    });
  };
  const options = trayControlOptions(request, draft, mode, sendFree);
  const control = useRollControl(options);
  const state = trayState({ request, rolling, result, manual: control.manual !== null });
  const shownMode = previewMode(
    held ?? mode,
    request?.kind === "control" ? request.previewMode : undefined,
  );

  const roll = (keys: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => {
    if (!live || !request) return;
    setError(null);
    if (free) {
      const m = modeFromKeys(keys, mode);
      const check = prepareExpression(draft.trim(), m);
      if (!check.ok) {
        setError(check.message);
        return;
      }
    }
    diceExtras.api.setState({ result: null });
    control.roll({ shiftKey: keys.shiftKey, ctrlKey: keys.ctrlKey }); // never Alt: already staged
  };

  const onKeyDown = (e: KeyboardEvent) => {
    trackKeys(e);
    if (e.key === "Escape" && request) {
      e.stopPropagation();
      diceExtras.clear();
    }
  };

  const terms = free ? (termsOf(draft) ?? lastValid.current) : [];
  const controlChips = useMemo(() => {
    if (request?.kind !== "control") return [];
    const o = request.options;
    const exprs = o.crit && o.critExpressions ? o.critExpressions : o.expressions;
    return exprs.map((x, i) => {
      const t = termsOf(x) ?? [];
      return {
        expr: x,
        chips: chipsOf(t, i === 0 ? shownMode : "normal"),
        constant: constantOfTerms(t),
      };
    });
  }, [request, shownMode]);
  const { options: actorList, selected } = actorSelection(
    actors,
    free?.actor
      ? (actors.find((a) => a.value && refKey(a.ref) === refKey(free.actor)) ?? null)
      : null,
  );
  const who = selected?.label;

  return (
    <section
      data-testid="dicex-tray"
      aria-label="Dice tray"
      className="flex h-full min-h-fit flex-col gap-2"
      onKeyDown={onKeyDown}
      onKeyUp={trackKeys}
      onPointerMove={(e) => {
        if (e.shiftKey || e.ctrlKey || held) trackKeys(e);
      }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            data-testid="dicex-tray-state"
            data-value={state}
            className="truncate text-xs text-muted-foreground"
          >
            {state === "idle" && IDLE_TEXT}
            {state === "compose" &&
              free &&
              `${who ? `${who} — ` : ""}${free.label ?? CATEGORY_LABEL[free.category]}`}
            {state === "adjust" &&
              request?.kind === "control" &&
              (request.options.label ?? CATEGORY_LABEL[request.options.category])}
            {state === "manual" && "Physical dice"}
            {state === "rolling" && "Rolling…"}
            {state === "result" && "Last roll"}
          </p>
        </div>
        <SettingsPopover />
      </div>

      {/* Dice area */}
      <div className="flex min-h-10 flex-wrap items-center gap-1">
        {state === "compose" &&
          chipsOf(terms, shownMode).map((c, i) => (
            <Chip
              // biome-ignore lint/suspicious/noArrayIndexKey: one chip per die position
              key={i}
              chip={c}
              onRemove={c.tag ? undefined : () => setTerms(removeDie(terms, c.term))}
            />
          ))}
        {state === "compose" && constantOfTerms(terms) !== 0 && (
          <span className="font-mono text-sm text-muted-foreground">
            {signed(constantOfTerms(terms))}
          </span>
        )}
        {state === "adjust" &&
          controlChips.map((g, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one group per expression position
            <span key={i} className="flex flex-wrap items-center gap-1">
              {i > 0 && <span className="px-1 text-muted-foreground">·</span>}
              {g.chips.map((c, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: one chip per die position
                <Chip key={j} chip={c} />
              ))}
              {g.constant !== 0 && (
                <span className="font-mono text-sm text-muted-foreground">
                  {signed(g.constant)}
                </span>
              )}
            </span>
          ))}
        {(state === "compose" || state === "adjust") && request && (
          <Extras request={request} mode={shownMode} />
        )}
        {state === "rolling" && <p className="text-sm text-muted-foreground">Rolling…</p>}
        {state === "result" && result && <ResultView entries={result} />}
      </div>

      {state === "manual" && (
        <div className="rounded-md border p-2">
          <ManualForm control={control} />
        </div>
      )}

      {(state === "idle" || state === "compose" || state === "result") && (
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Add a die</legend>
          {PALETTE.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant="outline"
              data-testid="dicex-tray-palette"
              data-value={f}
              className="h-7 px-2 font-mono text-xs"
              onClick={() => {
                // After a result the palette starts a new roll; else it adds to the request.
                const from = free && state !== "result" ? terms : [];
                diceExtras.api.setState({ result: null });
                setTerms(addDie(from, f));
              }}
            >
              d{f}
            </Button>
          ))}
        </fieldset>
      )}

      {state === "compose" && (
        <div className="flex items-center gap-1.5">
          <Input
            data-testid="dicex-tray-expression"
            aria-label="Dice expression"
            placeholder="1d20+4"
            className="h-7 min-w-0 flex-1 font-mono text-sm"
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              setError(null);
              const t = termsOf(v);
              if (t) {
                lastValid.current = t;
                update({ expression: v });
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              roll(e);
            }}
          />
          <Input
            data-testid="dicex-tray-constant"
            aria-label="Constant"
            inputMode="numeric"
            className="h-7 w-16 font-mono text-sm"
            value={String(constantOfTerms(terms))}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value.replace("−", "-"), 10);
              setTerms(setConstant(terms, Number.isNaN(n) ? 0 : n));
            }}
          />
        </div>
      )}

      {error && (
        <p data-testid="dicex-tray-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {control.error && (
        <p className="text-xs text-destructive" role="alert">
          {control.error}
        </p>
      )}

      {/* Bottom bar, like the roll bar (DICEX §7). */}
      {state !== "manual" && (
        <div className="mt-auto flex flex-col gap-1.5 border-t pt-1.5">
          <div className="flex items-center gap-1.5">
            <ToggleGroup
              type="single"
              data-testid="dicex-tray-mode"
              data-value={mode}
              aria-label="Roll mode"
              className="shrink-0"
              value={mode}
              disabled={!request || state === "rolling"}
              onValueChange={(v) => {
                if (v) diceExtras.setMode(v as RollMode);
              }}
            >
              {(["disadvantage", "normal", "advantage"] as const).map((m) => (
                <ToggleGroupItem
                  key={m}
                  value={m}
                  data-testid="dicex-tray-mode-option"
                  data-value={m}
                  aria-label={m}
                  className="h-7 px-2"
                >
                  {MODE_LABEL[m]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {control.isDm && request && (
              <Tooltip content={control.publicValue ? "Public" : "Hidden"}>
                <Button
                  type="button"
                  data-testid="dicex-tray-public"
                  data-state={control.publicValue ? "public" : "hidden"}
                  aria-label={control.publicValue ? "Public" : "Hidden"}
                  aria-pressed={control.publicValue}
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-7 shrink-0",
                    !control.publicValue && "text-visibility-hidden",
                  )}
                  onClick={() => control.setPublic(!control.publicValue)}
                >
                  {control.publicValue ? (
                    <EyeIcon className="size-4" />
                  ) : (
                    <EyeOffIcon className="size-4" />
                  )}
                </Button>
              </Tooltip>
            )}
            <span className="flex-1" />
            {request && (
              <Tooltip content="Clear (Esc)">
                <Button
                  type="button"
                  data-testid="dicex-tray-clear"
                  aria-label="Clear"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={() => diceExtras.clear()}
                >
                  <XIcon className="size-4" />
                </Button>
              </Tooltip>
            )}
            {state === "result" && free ? (
              <Button
                type="button"
                data-testid="dicex-tray-again"
                size="sm"
                className="h-7"
                disabled={!live}
                onClick={(e) => roll(e)}
              >
                Roll again
              </Button>
            ) : (
              <Button
                type="button"
                data-testid="dicex-tray-roll"
                size="sm"
                className="h-7"
                disabled={!live || !request || state === "rolling" || state === "result"}
                onClick={(e) => roll(e)}
              >
                Roll
              </Button>
            )}
            {free && (
              <Button
                type="button"
                data-testid="dicex-tray-options"
                aria-label="Roll options"
                aria-expanded={optionsOpen}
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={() => setOptionsOpen(!optionsOpen)}
              >
                {optionsOpen ? (
                  <ChevronUpIcon className="size-4" />
                ) : (
                  <ChevronDownIcon className="size-4" />
                )}
              </Button>
            )}
          </div>
          {free && optionsOpen && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                data-testid="dicex-tray-category"
                aria-label="Category"
                className={cn(SELECT, "max-w-28")}
                value={free.category}
                onChange={(e) => update({ category: e.target.value as RollCategory })}
              >
                {ROLL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                data-testid="dicex-tray-actor"
                aria-label="Roll as"
                className={cn(SELECT, "max-w-28")}
                value={selected?.value ?? ""}
                onChange={(e) => {
                  const a = actorList.find((x) => x.value === e.target.value);
                  update({ actor: a?.ref });
                }}
              >
                {actorList.map((a) => (
                  <option key={a.value} value={a.value} disabled={a.stale}>
                    {a.label}
                  </option>
                ))}
              </select>
              <Input
                data-testid="dicex-tray-label"
                aria-label="Label"
                placeholder="Label"
                maxLength={60}
                className="h-7 w-12 min-w-0 flex-1 text-xs"
                value={free.label ?? ""}
                onChange={(e) => update({ label: e.target.value || undefined })}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
