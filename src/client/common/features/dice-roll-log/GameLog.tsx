// Window `dice.log` body, both clients (FR-DICE-21, 22, 27, 30; DICE §7). Entries from the synced
// store; rolls go out as `dice.roll` intents. DM-only parts (public eye toggle, settings gear)
// render from `you.role` / the `dmTools` slot. Sprint 4: each `die` segment is an inline die-shape
// chip in the roller's look (FR-DICE-35); `focusLogEntry` highlights an entry (FR-DICE-37).
// Sprint 5: a line this client's dice haven't landed yet shows blank chips and "…" (FR-DICE-40);
// a `roll` line's actor name in the roller's player colour (FR-DICE-60, -61). Sprint 7 (GM1): a
// superseded line is struck through with a "rerolled" Badge that jumps to the new line
// (FR-DICE-65); entry actions from the registry at the line end (FR-DICE-68). Kit parity K1
// (§6.4): each entry is a 40-px row (medallion · "Name · action" · time · result boxes · chips ·
// actions, FR-KIT-40–44); the full line with its chips moves into the row's Tooltip (FR-KIT-45);
// screen readers and a copy read the full line as before (FR-KIT-46).

import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import {
  DICE_LOOK_TYPE,
  type DiceLook,
  type DiceLookRecord,
  lookOf,
} from "@shared/dice-extras/looks";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  copyText,
  ROW_RESULTS_MAX,
  type RowResult,
  rowAction,
  rowBadges,
  rowResults,
} from "@shared/dice-roll-log/row";
import {
  CATEGORY_LABEL,
  type DiceRollIntent,
  type DmRollActorRef,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  ROLL_CATEGORIES,
  type RollCategory,
  RollEntryPayload,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { SCENE_TYPE, type SceneView, TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DicesIcon,
  EyeIcon,
  EyeOffIcon,
  HandIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Medallion } from "../../components/kit/medallion";
import { ResultBox } from "../../components/kit/result-box";
import { Button } from "../../components/ui/button";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Input, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { DieShape } from "../dice-extras/DieShape";
import { useLanded, useLandingFade } from "../dice-extras/landing";
import { stageTray, type TrayRequest } from "../dice-extras/store";
import { DICEX_REQUESTS_KIND } from "../dice-extras/window-kind";
import { useOpenWindow } from "../play-shell/ShellContext";
import { EntryActions } from "./entry-action-button";
import { type EntryAction, entryActions } from "./entry-actions";
import { focusLogEntry, scrollToEntry, useLogFocus } from "./focus";
import {
  actorOptions,
  actorSelection,
  copiedRows,
  createStickToBottom,
  heldSegments,
  keepPinned,
  modeFromKeys,
  optionsDirty,
  repinOn,
  rowTime,
  type ShownSegment,
  sortEntries,
} from "./logic";
import { rollerAttr, rollerColorKey, useColorKeyOf } from "./name-color";
import { usePhysicalDice, useRollBarActor, useRollOptionsOpen } from "./physical";
import { RollButton, type RollKeys, useRollControl } from "./roll-control";

const SELECT =
  "h-7 min-w-0 shrink-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Segment({
  s,
  look,
  nameColor,
}: {
  s: ShownSegment;
  look: DiceLook;
  /** FR-DICE-60: the actor name's colour; null = the default text colour. */
  nameColor: string | null;
}) {
  if (s.die) {
    // FR-DICE-35: a wrapper per chip (review B31); the shape inside keeps `dicex-die`. A dropped
    // die's wrapper is `<s>`, as its text was (struck for assistive tech too). FR-DICE-40: held →
    // blank, no `data-value`; it fades in at the landing (`data-landing`). FR-DICE-93: an
    // `inline-block` wrapper (never `inline-flex`), so the line copies as one line.
    const d = s.die;
    const Wrap = d.kept ? "span" : "s";
    return (
      <Wrap
        data-testid="dice-log-die"
        data-faces={d.faces ?? ""}
        data-value={s.blank ? undefined : d.value}
        data-kept={d.kept}
        data-offered={d.offered === true}
        data-landing
        className="-my-0.5 inline-block align-middle leading-none"
      >
        <DieShape
          faces={d.faces}
          value={d.value}
          kept={d.kept}
          offered={d.offered === true}
          look={look}
          size="sm"
          blank={s.blank === true}
          label={`${d.label ? `${d.label} ` : ""}${d.faces ? `d${d.faces}` : "dice"}: ${s.text}`}
        />
      </Wrap>
    );
  }
  switch (s.style) {
    case "actor":
      return (
        <strong
          data-testid="dice-log-entry-actor"
          className="font-semibold"
          style={nameColor ? { color: nameColor } : undefined}
        >
          {s.text}
        </strong>
      );
    case "total":
      return (
        <strong data-landing className="font-semibold">
          {s.text}
        </strong>
      );
    case "dropped":
      return <s className="text-muted-foreground">{s.text}</s>;
    case "badge":
      return (
        <Badge
          variant="outline"
          // FR-DICE-93: inline-level text in the line, not the Badge's `inline-flex`. The row's
          // chip carries `dice-log-entry-manual` (FR-KIT-44).
          className="inline-block px-1 py-0 text-[10px]"
        >
          {s.text}
        </Badge>
      );
    case "muted":
      return <span className="text-muted-foreground italic">{s.text}</span>;
    default:
      return <span>{s.text}</span>;
  }
}

/** FR-DICE-40: a held line's Tooltip leaves out the dice until the landing. */
function tooltipOf(e: GameLogEntryView, landed: boolean): ReactNode {
  const time = new Date(e.at).toLocaleTimeString();
  const rolls = landed ? RollEntryPayload.safeParse(e.payload) : null;
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        {time}
        {/* FR-DICE-65: the Tooltip keeps the full line + "rerolled". */}
        {e.supersededBy !== null && !e.undone ? " · rerolled" : ""}
      </span>
      {rolls?.success &&
        rolls.data.map((r) => (
          <span key={r.rollId}>
            {r.expression}: [
            {r.dice.map((d) => `${d.value ?? "?"}${d.kept ? "" : " dropped"}`).join(", ")}]
            {r.constant !== 0 ? ` ${r.constant > 0 ? "+" : "-"} ${Math.abs(r.constant)}` : ""}
          </span>
        ))}
    </div>
  );
}

/**
 * FR-KIT-45: the entry Tooltip, built on open: the time (+ "rerolled"), the dice per roll, the
 * full line with its chips (FR-DICE-35), then the category. Held (FR-DICE-40): blank chips, "…".
 */
export function EntryDetails({ e }: { e: GameLogEntryView }) {
  const { segments } = useMemo(() => formatEntry(e), [e]);
  const landed = useLanded(e.id);
  const shown = useMemo(() => (landed ? segments : heldSegments(segments)), [segments, landed]);
  const look = useRollerLooks()(e);
  const color = rollerColorKey(useColorKeyOf(), e);
  const nameColor = color ? colorHex(color) : null;
  const line = useLandingFade<HTMLSpanElement>(landed);
  return (
    <div data-testid="dice-log-entry-details" className="flex max-w-96 flex-col gap-0.5">
      {tooltipOf(e, landed)}
      <span ref={line} data-testid="dice-log-entry-line" className="break-words">
        {shown.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
          <Segment key={i} s={s} look={look} nameColor={nameColor} />
        ))}
      </span>
      <span>{CATEGORY_LABEL[e.category]}</span>
    </div>
  );
}

/** FR-KIT-44: "+N" for the totals past the first two, listed in its Tooltip once landed. */
function MoreResults({ rest, landed }: { rest: readonly RowResult[]; landed: boolean }) {
  const more = (
    <span
      data-testid="dice-log-entry-more"
      tabIndex={landed ? 0 : undefined}
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      +{rest.length}
    </span>
  );
  if (!landed) return more;
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-0.5">
          {rest.map((r) => (
            <span key={r.rollId}>
              {r.label}: {r.total}
            </span>
          ))}
        </div>
      }
    >
      {more}
    </Tooltip>
  );
}

function Entry({
  e,
  isDm,
  color,
  focused,
  actions,
}: {
  e: GameLogEntryView;
  isDm: boolean;
  color: string | null;
  focused: boolean;
  actions: readonly EntryAction[];
}) {
  const { segments } = useMemo(() => formatEntry(e), [e]);
  const row = useMemo(() => rowAction(e), [e]);
  const results = useMemo(() => rowResults(e), [e]);
  // FR-DICE-40: only entries this client's live-throw path holds (FR-DICEX-49) wait.
  const landed = useLanded(e.id);
  const shown = useMemo(() => (landed ? segments : heldSegments(segments)), [segments, landed]);
  // The boxes' numbers fade in at the landing (`data-landing`), as the line's did.
  const li = useLandingFade<HTMLLIElement>(landed);
  const hidden = isDm && !e.public;
  const nameColor = color ? colorHex(color) : null;
  // FR-DICE-65: an undone line that is also superseded reads "undone" (its badge) only.
  const rerolled = e.supersededBy !== null && !e.undone ? e.supersededBy : null;
  // FR-DICE-65: struck through, and dimmed when rerolled.
  const struck = cn((e.undone || rerolled) && "line-through", rerolled && "opacity-60");
  // An element only: the Tooltip renders it on open (kit-parity §12).
  const details = <EntryDetails e={e} />;
  return (
    <li
      ref={li}
      data-testid="dice-log-entry"
      data-slot="log-row"
      data-record-id={e.id}
      data-color={color ?? undefined}
      data-roller={rollerAttr(e)}
      data-public={e.public}
      data-undone={e.undone}
      data-superseded={e.supersededBy !== null}
      data-focused={focused}
      data-landed={landed}
      aria-busy={landed ? undefined : true}
      // FR-KIT-40: one 40-px line, `medallion · what · time · boxes · chips · actions`.
      // visibility.hidden token (visual-direction): hidden entries muted with an eye-off marker.
      // FR-DICE-37: a focused entry gets the accent ring for 2 s.
      className={cn(
        "group/entry grid h-10 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-sm border-b border-border/60 px-1 text-sm transition-shadow",
        hidden && "text-visibility-hidden",
        focused && "ring-2 ring-ring",
      )}
    >
      {/* FR-KIT-41: the actor's initial on its name colour (FR-DICE-60), else neutral. */}
      {row.actor !== null ? (
        <Medallion name={row.actor} colour={nameColor} size="md" />
      ) : (
        <span aria-hidden className="size-7" />
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        {hidden && (
          <EyeOffIcon
            aria-label="Hidden from players"
            data-testid="dice-log-entry-hidden"
            className="size-3.5 shrink-0 text-visibility-hidden"
          />
        )}
        <Tooltip content={details}>
          {/* FR-KIT-42: "Name · action" on one line; screen readers read the full line below. */}
          <span
            data-testid="dice-log-entry-text"
            data-slot="log-what"
            aria-hidden
            className={cn("min-w-0 flex-1 truncate", struck)}
          >
            {row.actor !== null && (
              <>
                <strong
                  data-testid="dice-log-entry-actor"
                  className="font-semibold"
                  style={nameColor ? { color: nameColor } : undefined}
                >
                  {row.actor}
                </strong>
                <span className="text-muted-foreground"> · </span>
              </>
            )}
            <span className="text-muted-foreground">{row.text}</span>
          </span>
        </Tooltip>
        {/* FR-KIT-46: the full line (held: as shown), read aloud and copied per row. */}
        <span data-line className="sr-only">
          {copyText(shown)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* FR-KIT-43: hidden while the row is < 360 px wide (the list is the container). */}
        <time
          data-testid="dice-log-entry-time"
          data-slot="log-time"
          dateTime={e.at}
          aria-hidden
          className="hidden text-xs text-muted-foreground tabular-nums @min-[360px]/log:inline"
        >
          {rowTime(e.at)}
        </time>
        {results.slice(0, ROW_RESULTS_MAX).map((r) => (
          <ResultBox
            key={r.rollId}
            data-testid="dice-log-entry-total"
            data-record-id={r.rollId}
            data-landing
            value={r.total}
            outcome={r.outcome}
            held={!landed}
            tip={details}
            className={struck}
          />
        ))}
        {results.length > ROW_RESULTS_MAX && (
          <MoreResults rest={results.slice(ROW_RESULTS_MAX)} landed={landed} />
        )}
        {/* FR-KIT-44: "physical" (and "undone") after the boxes. */}
        {rowBadges(segments).map((b) => (
          <Badge
            key={b}
            aria-hidden
            variant="outline"
            data-testid={b === "physical" ? "dice-log-entry-manual" : undefined}
            className="shrink-0 px-1 py-0 text-[10px]"
          >
            {b}
          </Badge>
        ))}
        {rerolled && (
          <Tooltip content="Rerolled: show the new roll">
            <button
              type="button"
              data-testid="dice-log-rerolled"
              data-record-id={rerolled}
              aria-label="Rerolled: show the new roll"
              className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => focusLogEntry(rerolled)}
            >
              <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                rerolled
              </Badge>
            </button>
          </Tooltip>
        )}
        <EntryActions e={e} actions={actions} />
      </div>
    </li>
  );
}

/**
 * FR-DICE-21: oldest at the top; sticks to the bottom unless scrolled up, then "N new". The
 * roll bar's height changes (Options row, Physical strip; FR-DICE-30) and the rows' own (a theme
 * switch, late fonts) keep a pinned list pinned.
 */
function EntryList({
  entries,
  isDm,
  actions,
}: {
  entries: GameLogEntryView[];
  isDm: boolean;
  actions: readonly EntryAction[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const keyOf = useColorKeyOf();
  const focusedId = useLogFocus((s) => s.entryId);
  const focusSeq = useLogFocus((s) => s.seq);
  const [stick] = useState(createStickToBottom);
  const seen = useRef<number>(0);
  const [unseen, setUnseen] = useState(0);
  const lastN = entries.at(-1)?.n ?? 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stick.atBottom) {
      el.scrollTop = el.scrollHeight;
      seen.current = lastN;
      setUnseen(0);
    } else {
      setUnseen(entries.filter((x) => x.n > seen.current).length);
    }
  }, [lastN, entries, stick]);

  useLayoutEffect(() => {
    const el = ref.current;
    const content = listRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    return keepPinned(el, content, stick, ResizeObserver);
  }, [stick]);

  // FR-KIT-47: a theme switch (an `<html>` attribute) or late web fonts re-pin a pinned list.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof MutationObserver === "undefined") return;
    return repinOn(el, stick, document.documentElement, MutationObserver, document.fonts);
  }, [stick]);

  // FR-DICE-37: scroll the focused entry into view (on a new focus, and when the log mounts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per focus request (`focusSeq`)
  useLayoutEffect(() => {
    if (scrollToEntry(ref.current, focusedId)) stick.scrolled(ref.current as HTMLDivElement);
  }, [focusSeq]);

  // FR-KIT-46 (OQ-KIT-06 A): a selection over rows copies each row's full line, one per line.
  const copyLines = (ev: ClipboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const rows = ev.currentTarget.querySelectorAll<HTMLElement>('[data-testid="dice-log-entry"]');
    const text = copiedRows(
      rows,
      (li) => sel.containsNode(li, true),
      (li) => li.querySelector("[data-line]")?.textContent ?? "",
    );
    if (text === null) return;
    ev.clipboardData.setData("text/plain", text);
    ev.preventDefault();
  };

  const toBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.pin();
    seen.current = lastN;
    setUnseen(0);
  };

  return (
    // The list takes the space above the pinned roll bar and scrolls on its own; the scroller
    // fills the box absolutely so long entries never push the roll bar out. FR-SHELL-35: with
    // the one-row bar, ≥ 6 single-line entries at the default size, ≥ 4 with Physical dice on (e2e).
    <div className="relative min-h-10 flex-1">
      <div
        ref={ref}
        data-testid="dice-log-list"
        className="absolute inset-0 overflow-y-auto pr-1 [overflow-anchor:none]"
        onScroll={(ev) => {
          if (stick.scrolled(ev.currentTarget)) {
            seen.current = lastN;
            setUnseen(0);
          }
        }}
        onCopy={copyLines}
      >
        <ul ref={listRef} className="@container/log flex flex-col">
          {entries.map((e) => (
            <Entry
              key={e.id}
              e={e}
              isDm={isDm}
              color={rollerColorKey(keyOf, e)}
              focused={focusedId === e.id}
              actions={actions}
            />
          ))}
        </ul>
      </div>
      {unseen > 0 && (
        <button
          type="button"
          data-testid="dice-log-new"
          onClick={toBottom}
          className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground shadow"
        >
          {unseen} new
        </button>
      )}
    </div>
  );
}

const MODE_LABEL: Record<RollMode, string> = {
  disadvantage: "Dis",
  normal: "Normal",
  advantage: "Adv",
};

function errorText(err: unknown): string {
  if (err instanceof IntentRejected) {
    const issue = (err.issues as { message?: string }[] | undefined)?.[0]?.message;
    return issue ?? err.message;
  }
  return err instanceof Error ? err.message : "Roll failed";
}

/** FR-DICEX-51 (§6.1 table G): the roll bar Roll's tooltip; `RollButton` adds the Alt hint. */
export const ROLL_BAR_HINT = "Shift: advantage · Ctrl: disadvantage";

/**
 * FR-DICEX-06: what the tray Button stages — and Alt+click on Roll (FR-DICEX-51, OQ-DICEX-45 A),
 * Shift / Ctrl picking the mode as a roll would: the bar's expression, `free`.
 */
export function rollBarStage(
  bar: {
    expression: string;
    mode: RollMode;
    label: string;
    category: RollCategory;
    actor?: DmRollActorRef | undefined;
  },
  keys?: RollKeys,
): TrayRequest {
  return {
    kind: "free",
    expression: bar.expression.trim(),
    mode: modeFromKeys(keys, bar.mode),
    category: bar.category,
    ...(bar.label.trim() ? { label: bar.label.trim() } : {}),
    ...(bar.actor ? { actor: bar.actor } : {}),
  };
}

/** FR-DICE-22 / FR-DICE-30: the roll bar (window footer). */
function RollBar({ dmTools }: { dmTools?: ReactNode }) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const [expression, setExpression] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<RollCategory>("other");
  const [mode, setMode] = useState<RollMode>("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const scenes = useRecords<SceneView>(SCENE_TYPE);
  const tokens = useRecords<TokenView>(TOKEN_TYPE);
  const encounters = useRecords<EncounterRecord>(ENCOUNTER_TYPE);
  const combatants = useRecords<CombatantRecord>(COMBATANT_TYPE);
  const actors = useMemo(
    () => actorOptions(you, entities, scenes, tokens, encounters, combatants),
    [you, entities, scenes, tokens, encounters, combatants],
  );
  // FR-DICE-77: a player's default is the sheet's PC; their pick is kept per browser.
  const [actor, setActor] = useRollBarActor(actors);
  // A token that left the active scene, a removed character or an ended / removed combatant
  // (FR-DICE-34) falls back to the roller.
  const { options: actorList, selected } = actorSelection(actors, actor);
  const actorRef = selected?.ref;

  const control = useRollControl({
    expressions: [expression],
    category,
    label: `${selected?.label ?? "Roll"} — ${label.trim() || CATEGORY_LABEL[category]}`,
    mode,
    onRoll(r) {
      const intent: DiceRollIntent = { expression, mode: r.mode, category };
      if (label.trim()) intent.label = label;
      if (actorRef) intent.actor = actorRef;
      if (r.manual?.[0]) intent.manual = r.manual[0];
      if (r.public !== undefined) intent.public = r.public;
      setBusy(true);
      setError(null);
      connection
        .sendIntent("dice.roll", intent)
        .then(() => {
          setExpression("");
          setLabel("");
        })
        .catch((err: unknown) => {
          setError(errorText(err));
          // FR-DICE-34: the answer to a pick that left the list (not_found) drops it.
          if (selected?.stale) setActor(null);
        })
        .finally(() => setBusy(false));
    },
  });
  const disabled = !live || busy;
  const shownError = error ?? control.error;
  const stage = (keys?: RollKeys) =>
    stageTray(rollBarStage({ expression, mode, label, category, actor: actorRef }, keys));
  const [optionsOpen, setOptionsOpen] = useRollOptionsOpen();
  const [physical, setPhysical] = usePhysicalDice();
  const dirty = optionsDirty({
    category,
    actor: selected?.value ?? "",
    label,
    isDm: control.isDm,
    publicValue: control.publicValue,
    publicPreset: control.publicPreset,
  });

  // FR-DICE-30: a one-row pinned footer (expression, mode, DM eye, Roll, Options chevron), so
  // the entry list keeps the window's height (FR-SHELL-35). Options open a second row; the
  // "Physical dice on" strip shows below the first row whenever the mode is on (FR-DICE-07).
  // FR-DICE-39: in the wide log the controls stay left at their narrow widths (input ≤ 320 px).
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t pt-1">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Input
          data-testid="dice-roll-expression"
          aria-label="Dice expression"
          placeholder="1d20+4"
          className="h-7 w-16 min-w-0 max-w-80 flex-1 font-mono text-sm"
          value={expression}
          disabled={!live}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || disabled || e.nativeEvent.isComposing) return;
            e.preventDefault();
            control.roll({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey }); // Enter rolls at once
          }}
        />
        <ToggleGroup
          type="single"
          data-testid="dice-roll-mode"
          data-value={mode}
          aria-label="Roll mode"
          className="shrink-0"
          value={mode}
          disabled={!live}
          onValueChange={(v) => {
            if (v) setMode(v as RollMode);
          }}
        >
          {(["disadvantage", "normal", "advantage"] as const).map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              data-testid="dice-roll-mode-option"
              data-value={m}
              aria-label={m}
              className="h-7 px-2"
            >
              {MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {control.isDm && (
          <Tooltip content={control.publicValue ? "Public" : "Hidden"}>
            <Button
              type="button"
              data-testid="dice-roll-public"
              data-state={control.publicValue ? "public" : "hidden"}
              aria-label={control.publicValue ? "Public" : "Hidden"}
              aria-pressed={control.publicValue}
              size="icon"
              variant="ghost"
              className={cn("size-7 shrink-0", !control.publicValue && "text-visibility-hidden")}
              disabled={!live}
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
        <RollButton
          control={control}
          hint={ROLL_BAR_HINT}
          data-testid="dice-roll-submit"
          type="button"
          size="sm"
          className="h-7"
          disabled={disabled || expression.trim() === ""}
          onClick={(e) => {
            if (!e.altKey) return;
            e.preventDefault();
            stage(e);
          }}
        >
          Roll
        </RollButton>
        <Tooltip content="Adjust in dice tray">
          <Button
            type="button"
            data-testid="dicex-tray-open"
            aria-label="Adjust in dice tray"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => stage()}
          >
            <DicesIcon className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content={optionsOpen ? "Hide roll options" : "Roll options"}>
          <Button
            type="button"
            data-testid="dice-roll-options"
            data-state={optionsOpen ? "open" : "closed"}
            data-dirty={dirty}
            aria-label="Roll options"
            aria-expanded={optionsOpen}
            aria-controls={`${uid}-options`}
            size="icon"
            variant="ghost"
            className="relative size-7 shrink-0"
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            {optionsOpen ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
            {dirty && (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
              />
            )}
          </Button>
        </Tooltip>
      </form>
      {physical && <PhysicalStrip onOff={() => setPhysical(false)} />}
      {optionsOpen && (
        <div id={`${uid}-options`} className="flex flex-wrap items-center gap-1.5">
          <select
            data-testid="dice-roll-category"
            aria-label="Category"
            className={cn(SELECT, "max-w-28")}
            value={category}
            disabled={!live}
            onChange={(e) => setCategory(e.target.value as RollCategory)}
          >
            {ROLL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            data-testid="dice-roll-actor"
            aria-label="Roll as"
            className={cn(SELECT, "max-w-24")}
            value={selected?.value ?? ""}
            disabled={!live}
            onChange={(e) => setActor(actors.find((a) => a.value === e.target.value) ?? null)}
          >
            {actorList
              .filter((a) => !a.group)
              .map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            {(["Characters", "Tokens", "Combatants"] as const).map((g) => {
              const list = actorList.filter((a) => a.group === g);
              return list.length === 0 ? null : (
                <optgroup key={g} label={g}>
                  {list.map((a) => (
                    <option key={a.value} value={a.value} disabled={a.stale}>
                      {a.stale ? `${a.label} (gone)` : a.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <Input
            data-testid="dice-roll-label"
            aria-label="Label"
            placeholder="Label"
            maxLength={60}
            className="h-7 w-12 min-w-0 max-w-60 flex-1 text-xs"
            value={label}
            disabled={!live}
            onChange={(e) => setLabel(e.target.value)}
          />
          {dmTools && <div className="shrink-0">{dmTools}</div>}
          {dmTools && <RequestButton />}
          <Tooltip content="Physical dice: type in my own rolls">
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <Switch
                id={`${uid}-physical`}
                data-testid="dice-roll-physical"
                aria-label="Physical dice"
                checked={physical}
                onCheckedChange={setPhysical}
              />
              <label htmlFor={`${uid}-physical`}>
                <HandIcon className="size-3.5" aria-hidden />
              </label>
            </span>
          </Tooltip>
        </div>
      )}
      {shownError && (
        <p data-testid="dice-roll-error" role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}

/** FR-DICE-84 (sprint 8): the DM's "Request…" opens the Requests window (`dicex.requests`). */
function RequestButton() {
  const open = useOpenWindow();
  return (
    <Button
      type="button"
      data-testid="dicex-request-open"
      size="sm"
      variant="outline"
      className="h-7 shrink-0 px-2 text-xs"
      onClick={() => open(DICEX_REQUESTS_KIND)}
    >
      Request…
    </Button>
  );
}

/**
 * FR-DICE-07 / FR-DICE-30: while physical-dice mode is on, a "Physical dice on" strip with
 * "Turn off" sits below the first row, Options open or not, so the mode is never a surprise.
 */
function PhysicalStrip({ onOff }: { onOff: () => void }) {
  return (
    <div
      data-testid="dice-log-physical"
      role="status"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-1.5 text-xs"
    >
      <HandIcon className="size-3.5 shrink-0 text-warning" />
      <span className="flex-1 truncate">Physical dice on</span>
      <button
        type="button"
        data-testid="dice-log-physical-off"
        className="rounded-sm font-medium underline-offset-2 hover:underline"
        onClick={onOff}
      >
        Turn off
      </button>
    </div>
  );
}

/** FR-DICE-35: chips in the roller's look (FR-DICEX-20): their `dice-look` row, else the default. */
function useRollerLooks(): (e: GameLogEntryView) => DiceLook {
  const rows = useRecords<DiceLookRecord>(DICE_LOOK_TYPE);
  const players = useRecords<PlayerRecord>("player");
  return useMemo(() => {
    const ids = players.map((p) => p.id);
    const cache = new Map<string, DiceLook>();
    return (e) => {
      const owner = e.rollerRole === "dm" ? null : e.rollerPlayerId;
      const key = owner ?? "";
      let look = cache.get(key);
      if (!look) {
        look = lookOf(owner, rows, ids);
        cache.set(key, look);
      }
      return look;
    };
  }, [rows, players]);
}

/**
 * The `dice.log` window body. `dmTools`: the DM's settings gear (FR-DICE-22). `actions`: the
 * entry-action registry (FR-DICE-68; tests pass their own).
 */
export function GameLog({
  dmTools,
  actions = entryActions,
}: {
  dmTools?: ReactNode;
  actions?: readonly EntryAction[];
}) {
  const records = useRecords<GameLogEntryView>(GAME_LOG_ENTRY_TYPE);
  const everLive = useSync((s) => s.everLive);
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const entries = useMemo(() => sortEntries(records), [records]);
  return (
    <section
      data-testid="dice-log"
      aria-label="Game log"
      // h-full: the roll bar is a pinned footer and only the entry list scrolls. Below the roll
      // bar's own height (a window resized near its minimum) the body scrolls as a last resort.
      // FR-DICE-38: it reaches into the body's vertical padding (6 px each side) and keeps its
      // gaps tight, so the 160-high log shows ≥ 3 entries (≥ 2 with Physical dice on).
      className="-my-1.5 flex h-[calc(100%+0.75rem)] min-h-fit flex-col gap-1"
    >
      {!everLive ? (
        <div className="flex flex-1 flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p
          data-testid="dice-log-empty"
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          No rolls yet
        </p>
      ) : (
        <EntryList entries={entries} isDm={isDm} actions={actions} />
      )}
      <RollBar dmTools={isDm ? dmTools : undefined} />
    </section>
  );
}
