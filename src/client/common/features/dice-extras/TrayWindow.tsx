// Window `dicex.tray` body (FR-DICEX-01–10; DICEX §7): the roll control's second face. `free`
// requests are composed here and sent as `dice.roll`; `control` requests (Alt+click) roll through
// the caller's own `onRoll`, so the caller sends its own intent. One `RollControl` per host: the
// tray runs `useRollControl` on the staged options, so physical dice show the same `ManualForm`.
// FR-DICEX-53: the body is fixed parts (header, palette; expression row, bottom bar) around one
// flexible dice area; only the dice area shrinks or scrolls, so Roll stays visible at min size.
// *(Sprint 8)* FR-DICEX-69, -70: the header's Macros popover (by the gear) and "Save as macro" in
// the Options row; the list and editor load lazily (`TableTools` chunk).

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
  BookmarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { lazyChunk } from "../../lib/lazy-chunk";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import {
  actorItemValue,
  actorLabel,
  actorOptions,
  actorSelection,
  HELD_TEXT,
  heldSegments,
  modeFromKeys,
} from "../dice-roll-log/logic";
import {
  ManualForm,
  type RollControlOptions,
  type RollRequest,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { FlatDie } from "./FlatDie";
import { useHolding, useLandingFade } from "./landing";
import { draftOf, type MacroDraft } from "./macro-logic";
import { useOwnLook } from "./own-look";
import { SettingsPanel } from "./SettingsPanel";
import { diceExtras, type TrayRequest, useDiceExtras } from "./store";
import { type AreaBox, type TrayGroup, TrayPreview } from "./TrayPreview";
import {
  addDie,
  chipsOf,
  constantOfTerms,
  editRequest,
  editStartsFresh,
  notationOf,
  notationScale,
  PALETTE,
  previewMode,
  removeDie,
  scaledFont,
  scaledPx,
  setConstant,
  termsOf,
  trayScale,
} from "./tray-logic";

export type TrayState = "idle" | "compose" | "adjust" | "manual" | "rolling" | "result";

/** K10 (K6 gap 8): the options row's Select triggers, as small as the native selects were. */
const SELECT = "h-7 min-w-0 shrink-0 gap-1 px-1.5 py-0 text-xs [&>span]:truncate";

const MODE_LABEL: Record<RollMode, string> = {
  disadvantage: "Dis",
  normal: "Normal",
  advantage: "Adv",
};

const IDLE_TEXT = "Click dice in any text, Alt+click a roll button, or pick dice below";

/**
 * FR-DICEX-53 (§12 tray budget): the fixed parts' heights in px, as their classes draw them
 * (header `h-6`, palette and expression row `h-7`, bottom bar `border-t pt-1` + a 28-px row), the gap
 * between parts (`gap-1`) and the dice area's padding (`py-1.5`: room for a die's tag and "×N").
 */
export const TRAY_PART_PX = { header: 24, palette: 28, expression: 28, bar: 33 } as const;
export const TRAY_GAP = 4;
export const DICE_AREA_PAD = 12;

/** FR-DICEX-53: the dice area's content height for a body of `bodyH` px and these fixed parts. */
export function trayLayout(bodyH: number, parts: readonly number[]): { dice: number } {
  const fixed = parts.reduce((n, h) => n + h, 0) + parts.length * TRAY_GAP;
  return { dice: Math.max(0, bodyH - fixed - DICE_AREA_PAD) };
}

/** The dice area's content box, kept up to date as the tray resizes (FR-DICEX-54). */
function useAreaBox(ref: RefObject<HTMLElement | null>): AreaBox | null {
  const [box, setBox] = useState<AreaBox | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof getComputedStyle !== "function") return;
    const read = () => {
      const cs = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const w = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
      const h = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/**
 * FR-DICEX-96: the dice and notation scales from the tray window's rendered size (its `ui-window`
 * frame, kept up to date as it resizes); × 1 until measured.
 */
function useTrayScale(ref: RefObject<HTMLElement | null>): { dice: number; notation: number } {
  const [scale, setScale] = useState({ dice: 1, notation: 1 });
  useLayoutEffect(() => {
    const frame = ref.current?.closest<HTMLElement>('[data-testid="ui-window"]');
    if (!frame) return;
    const read = () => {
      const win = { w: frame.offsetWidth, h: frame.offsetHeight };
      const dice = trayScale(win);
      const notation = notationScale(win);
      setScale((s) => (s.dice === dice && s.notation === notation ? s : { dice, notation }));
    };
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

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

/** FR-DICEX-36 / DICEX §7: the tray's gear → the settings popover. */
function SettingsPopover() {
  const [pane, setPane] = useState<"settings" | "look">("settings");
  return (
    <Popover onOpenChange={(o) => !o && setPane("settings")}>
      <PopoverTrigger asChild>
        <Button
          data-testid="dicex-settings-open"
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label="Dice settings"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className={cn("flex flex-col gap-3", pane === "look" ? "w-72" : "w-80")}
      >
        <SettingsPanel pane={pane} onPane={setPane} />
      </PopoverContent>
    </Popover>
  );
}

const MacrosPanel = lazyChunk(
  () => import("./MacrosPanel").then((m) => ({ default: m.MacrosPanel })),
  "inline",
);

/**
 * FR-DICEX-69: the header's Macros button (24 px, by the gear, FR-DICEX-53) → the macro list,
 * the tray's actor first. `preset` (Save as macro, FR-DICEX-70) opens it on the editor.
 */
function MacrosPopover({
  actorId,
  preset,
  open,
  onOpenChange,
}: {
  actorId: string | null;
  preset: MacroDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          data-testid="dicex-tray-macros"
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label="Macros"
        >
          <BookmarkIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="max-h-96 w-80 overflow-y-auto">
        <Suspense fallback={null}>
          {open && (
            <MacrosPanel
              key={preset ? JSON.stringify(preset) : "list"}
              actorId={actorId}
              preset={preset}
            />
          )}
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

/**
 * `result`: the last own roll as flat dice, its total and the log line (FR-DICEX-10). FR-DICEX-49
 * (table E): while its entries are held, blank die shapes and "…"; at the landing the numbers
 * fade in.
 */
function ResultView({ entries, scale }: { entries: GameLogEntryView[]; scale: number }) {
  const t = useMemo(() => throwDice(entries), [entries]);
  const look = useOwnLook();
  const holding = useHolding();
  const landed = entries.every((e) => !holding.has(e.id));
  const fade = useLandingFade<HTMLDivElement>(landed);
  const lines = entries.map((e) => {
    const { segments } = formatEntry(e);
    return (holding.has(e.id) ? heldSegments(segments) : segments).map((s) => s.text).join("");
  });
  return (
    <div ref={fade} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {t?.dice.map((d) => (
          <FlatDie key={d.key} die={d} look={look} blank={holding.has(d.entryId)} scale={scale} />
        ))}
        {t && t.more > 0 && <span className="text-xs text-muted-foreground">+{t.more} more</span>}
        {t && t.totals.length > 0 && (
          <strong
            data-testid="dicex-tray-total"
            data-landed={landed}
            data-landing
            className="ml-1 text-lg"
            style={scaledFont(18, scale)}
          >
            {landed ? t.totals.join(" · ") : HELD_TEXT}
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
  const [macros, setMacros] = useState<{ open: boolean; preset: MacroDraft | null }>({
    open: false,
    preset: null,
  });
  const free = request?.kind === "free" ? request : null;
  const [draft, setDraft] = useState(free?.expression ?? "");
  const lastValid = useRef(termsOf(draft) ?? []);
  const diceArea = useRef<HTMLDivElement>(null);
  const area = useAreaBox(diceArea);
  const { dice: scale, notation: rowScale } = useTrayScale(diceArea);
  // FR-DICEX-96: the notation row stays 28 px (14-px text) up to the useful size, then grows.
  const notation =
    rowScale === 1 ? undefined : { height: scaledPx(28, rowScale), ...scaledFont(14, rowScale) };

  // A new stage resets the draft to the request's (FR-DICEX-02); the store resets the mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per stage (`staged`)
  useEffect(() => {
    const r = diceExtras.api.getState().request;
    setError(null);
    const expression = r?.kind === "free" ? r.expression : "";
    setDraft(expression);
    lastValid.current = termsOf(expression) ?? [];
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
  /** FR-DICEX-50: `fresh` = after a result: a new roll carries nothing of the old request. */
  const edit = (expression: string, fresh: boolean) => {
    if (!fresh) return update({ expression });
    const next = editRequest(free, expression, mode, true);
    diceExtras.api.setState({ request: { kind: "free", ...next }, result: null });
  };
  const setTerms = (terms: ReturnType<typeof addDie>, fresh = false) => {
    const expression = notationOf(terms);
    lastValid.current = terms;
    setDraft(expression);
    setError(null);
    edit(expression, fresh);
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
  const control = useRollControl(options, { tray: request?.kind === "control" });
  const state = trayState({ request, rolling, result, manual: control.manual !== null });
  // FR-DICEX-50 (table F): an edit after a result, or over a `control` request, starts fresh.
  const fresh = editStartsFresh(state, request?.kind ?? null);
  // FR-DICEX-08 e: MOD's preview (FR-MOD-27) combines the tray's mode with the effects (5e);
  // without a subject, the tray's own mode first, else the request's `previewMode`.
  const shownMode = control.preview.active
    ? control.preview.modeFor(held ?? mode)
    : previewMode(held ?? mode, request?.kind === "control" ? request.previewMode : undefined);

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
  // FR-DICEX-48: what the dice area previews: `free` = the composed terms; `control` = each
  // expression's dice (crit per FR-DICE-31), the first with the previewed mode, each group with
  // its slot label (FR-DICE-41).
  const groups = useMemo((): TrayGroup[] => {
    if (request?.kind !== "control") {
      return [{ chips: chipsOf(terms, shownMode), constant: constantOfTerms(terms) }];
    }
    const o = request.options;
    const exprs = o.crit && o.critExpressions ? o.critExpressions : o.expressions;
    return exprs.map((x, i) => {
      const t = termsOf(x) ?? [];
      return {
        chips: chipsOf(t, i === 0 ? shownMode : "normal"),
        constant: constantOfTerms(t),
        label: o.slotLabels?.[i] ?? null,
      };
    });
  }, [request, terms, shownMode]);
  const { options: actorList, selected } = actorSelection(
    actors,
    free?.actor
      ? (actors.find((a) => a.value && refKey(a.ref) === refKey(free.actor)) ?? null)
      : null,
  );
  // The header names a picked actor only (FR-DICEX-50: a fresh request reads "Other").
  const who = free?.actor ? selected?.label : undefined;

  return (
    <section
      data-testid="dicex-tray"
      aria-label="Dice tray"
      data-scale={scale}
      data-notation-scale={rowScale}
      className="flex h-full min-h-0 flex-col gap-1"
      onKeyDown={onKeyDown}
      onKeyUp={trackKeys}
      onPointerMove={(e) => {
        if (e.shiftKey || e.ctrlKey || held) trackKeys(e);
      }}
    >
      <div data-tray-part="header" className="flex h-6 shrink-0 items-center gap-2">
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
        <MacrosPopover
          actorId={free?.actor && "entityId" in free.actor ? free.actor.entityId : null}
          preset={macros.preset}
          open={macros.open}
          onOpenChange={(open) => setMacros({ open, preset: null })}
        />
        <SettingsPopover />
      </div>

      {(state === "idle" || state === "compose" || state === "result") && (
        <fieldset data-tray-part="palette" className="grid shrink-0 grid-cols-7 gap-1">
          <legend className="sr-only">Add a die</legend>
          {PALETTE.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant="outline"
              data-testid="dicex-tray-palette"
              data-value={f}
              className="h-7 min-w-0 px-0 font-mono text-xs"
              onClick={() => {
                // After a result the palette starts a new roll; else it adds to the request.
                diceExtras.api.setState({ result: null });
                setTerms(addDie(fresh ? [] : terms, f), fresh);
              }}
            >
              d{f}
            </Button>
          ))}
        </fieldset>
      )}

      {/* Dice area: the one flexible part (FR-DICEX-53); scrolls on its own (FR-DICEX-54). */}
      <div
        ref={diceArea}
        data-testid="dicex-tray-area"
        className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1 overflow-y-auto overflow-x-hidden py-1.5 pr-1.5"
      >
        {(state === "compose" || state === "adjust" || state === "rolling") && request && (
          <TrayPreview
            request={request}
            groups={groups}
            mode={shownMode}
            onRemove={state === "compose" ? (term) => setTerms(removeDie(terms, term)) : undefined}
            dimmed={state === "rolling"}
            area={area}
            scale={scale}
          />
        )}
        {state === "rolling" && !request && (
          <p className="text-sm text-muted-foreground">Rolling…</p>
        )}
        {state === "result" && result && <ResultView entries={result} scale={scale} />}
        {state === "manual" && (
          <div className="w-full rounded-md border p-2">
            <ManualForm control={control} />
          </div>
        )}
      </div>

      {/* FR-DICEX-50: typing after a result starts a fresh request, as the palette does. */}
      {(state === "compose" || state === "result") && (
        <div data-tray-part="expression" className="flex shrink-0 items-center gap-1.5">
          <Input
            data-testid="dicex-tray-expression"
            aria-label="Dice expression"
            placeholder="1d20+4"
            className="h-7 min-w-0 flex-1 font-mono text-sm"
            style={notation}
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              setError(null);
              const t = termsOf(v);
              if (t) lastValid.current = t;
              if (t || fresh) edit(t ? v : "", fresh);
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
            style={notation}
            value={String(constantOfTerms(terms))}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value.replace("−", "-"), 10);
              setTerms(setConstant(terms, Number.isNaN(n) ? 0 : n), fresh);
            }}
          />
        </div>
      )}

      {error && (
        <p
          data-testid="dicex-tray-error"
          role="alert"
          className="shrink-0 truncate text-xs text-destructive"
          title={error}
        >
          {error}
        </p>
      )}
      {control.error && (
        <p
          className="shrink-0 truncate text-xs text-destructive"
          role="alert"
          title={control.error}
        >
          {control.error}
        </p>
      )}

      {/* Bottom bar, like the roll bar (DICEX §7). */}
      {state !== "manual" && (
        <div
          data-testid="dicex-tray-bar"
          data-tray-part="bar"
          className="flex shrink-0 flex-col gap-1.5 border-t pt-1"
        >
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
                  // 26 px + the group's 1-px border = the bar's 28-px row (FR-DICEX-53 budget).
                  className="h-[26px] px-2"
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
              {/* K10 (K6 gap 8): the shared Select, as the roll bar's (K8): the trigger keeps the
                  test ID and carries the value, each item `…-option` + `data-value`. */}
              <Select
                value={free.category}
                onValueChange={(v) => update({ category: v as RollCategory })}
              >
                <SelectTrigger
                  data-testid="dicex-tray-category"
                  data-value={free.category}
                  aria-label="Category"
                  className={cn(SELECT, "max-w-28")}
                >
                  <SelectValue>{CATEGORY_LABEL[free.category]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLL_CATEGORIES.map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      data-testid="dicex-tray-category-option"
                      data-value={c}
                    >
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={actorItemValue(selected?.value ?? "")}
                onValueChange={(v) => {
                  const a = actorList.find((x) => actorItemValue(x.value) === v);
                  update({ actor: a?.ref });
                }}
              >
                <SelectTrigger
                  data-testid="dicex-tray-actor"
                  data-value={selected?.value ?? ""}
                  aria-label="Roll as"
                  className={cn(SELECT, "max-w-28")}
                >
                  <SelectValue>{selected ? selected.label : ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {actorList.map((a) => (
                    <SelectItem
                      key={a.value}
                      value={actorItemValue(a.value)}
                      disabled={a.stale}
                      data-testid="dicex-tray-actor-option"
                      data-value={a.value}
                    >
                      {actorLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                data-testid="dicex-tray-label"
                aria-label="Label"
                placeholder="Label"
                maxLength={60}
                className="h-7 w-12 min-w-0 flex-1 text-xs"
                value={free.label ?? ""}
                onChange={(e) => update({ label: e.target.value || undefined })}
              />
              <Button
                type="button"
                data-testid="dicex-tray-save-macro"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={!draft.trim()}
                onClick={() =>
                  setMacros({
                    open: true,
                    preset: draftOf({
                      name: free.label ?? "",
                      expression: draft.trim(),
                      category: free.category,
                      creatureId:
                        free.actor && "entityId" in free.actor ? free.actor.entityId : null,
                    }),
                  })
                }
              >
                Save as macro
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
