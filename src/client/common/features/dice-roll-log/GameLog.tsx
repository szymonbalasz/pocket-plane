// Window `dice.log` body, both clients (FR-DICE-21, 22, 27; DICE §7). Entries from the synced
// store; rolls go out as `dice.roll` intents. DM-only parts (public switch, settings gear)
// render from `you.role` / the `dmTools` slot.
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  CATEGORY_LABEL,
  type DiceRollIntent,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  ROLL_CATEGORIES,
  type RollCategory,
  RollEntryPayload,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { SCENE_TYPE, type SceneView, TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import { EyeOffIcon, HandIcon } from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Input, Skeleton } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import { actorOptions, sortEntries } from "./logic";
import { usePhysicalDice } from "./physical";
import { RollButton, useRollControl } from "./roll-control";

const SELECT =
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Segment({ s }: { s: LineSegment }) {
  switch (s.style) {
    case "actor":
    case "total":
      return <strong className="font-semibold">{s.text}</strong>;
    case "dropped":
      return <s className="text-muted-foreground">{s.text}</s>;
    case "badge":
      return (
        <Badge
          variant="outline"
          className="px-1 py-0 text-[10px]"
          data-testid={s.text === "physical" ? "dice-log-entry-manual" : undefined}
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

function tooltipOf(e: GameLogEntryView): ReactNode {
  const time = new Date(e.at).toLocaleTimeString();
  const rolls = RollEntryPayload.safeParse(e.payload);
  return (
    <div className="flex flex-col gap-0.5">
      <span>{time}</span>
      {rolls.success &&
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

function Entry({ e, isDm }: { e: GameLogEntryView; isDm: boolean }) {
  const { segments } = useMemo(() => formatEntry(e), [e]);
  const hidden = isDm && !e.public;
  return (
    <li
      data-testid="dice-log-entry"
      data-record-id={e.id}
      data-public={e.public}
      data-undone={e.undone}
      // visibility.hidden token (visual-direction): hidden entries muted with an eye-off marker.
      className={cn(
        "flex items-start gap-1.5 py-0.5 text-sm leading-snug",
        hidden && "text-visibility-hidden",
      )}
    >
      {hidden && (
        <EyeOffIcon
          aria-label="Hidden from players"
          data-testid="dice-log-entry-hidden"
          className="mt-0.5 size-3.5 shrink-0 text-visibility-hidden"
        />
      )}
      <Tooltip content={tooltipOf(e)}>
        <span className={cn("min-w-0 flex-1 break-words", e.undone && "line-through")}>
          {segments.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
            <Segment key={i} s={s} />
          ))}
        </span>
      </Tooltip>
      <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[10px] text-muted-foreground">
        {CATEGORY_LABEL[e.category]}
      </Badge>
    </li>
  );
}

/** FR-DICE-21: oldest at the top; sticks to the bottom unless scrolled up, then "N new". */
function EntryList({ entries, isDm }: { entries: GameLogEntryView[]; isDm: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seen = useRef<number>(0);
  const [unseen, setUnseen] = useState(0);
  const lastN = entries.at(-1)?.n ?? 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
      seen.current = lastN;
      setUnseen(0);
    } else {
      setUnseen(entries.filter((x) => x.n > seen.current).length);
    }
  }, [lastN, entries]);

  const toBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    seen.current = lastN;
    setUnseen(0);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        className="h-full overflow-y-auto pr-1"
        onScroll={(ev) => {
          const el = ev.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          if (atBottom.current) {
            seen.current = lastN;
            setUnseen(0);
          }
        }}
      >
        <ul className="flex flex-col">
          {entries.map((e) => (
            <Entry key={e.id} e={e} isDm={isDm} />
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

/** FR-DICE-22: the roll bar (window footer). */
function RollBar({ dmTools }: { dmTools?: ReactNode }) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const [physical, setPhysical] = usePhysicalDice();
  const [expression, setExpression] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<RollCategory>("other");
  const [actor, setActor] = useState("");
  const [mode, setMode] = useState<RollMode>("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  const scenes = useRecords<SceneView>(SCENE_TYPE);
  const tokens = useRecords<TokenView>(TOKEN_TYPE);
  const actors = useMemo(
    () => actorOptions(you, entities, scenes, tokens),
    [you, entities, scenes, tokens],
  );
  // A token that left the active scene (or a removed character) falls back to the roller.
  const selected = actors.find((a) => a.value === actor) ?? actors[0];
  const actorRef = selected?.ref;

  const control = useRollControl({
    expressions: [expression],
    category,
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
        .catch((err: unknown) => setError(errorText(err)))
        .finally(() => setBusy(false));
    },
  });
  const disabled = !live || busy;
  const shownError = error ?? control.error;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t pt-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Input
          data-testid="dice-roll-expression"
          aria-label="Dice expression"
          placeholder="1d20+4"
          className="h-8 flex-1 font-mono text-sm"
          value={expression}
          disabled={!live}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || disabled || e.nativeEvent.isComposing) return;
            e.preventDefault();
            control.roll(e);
          }}
        />
        <RollButton
          control={control}
          data-testid="dice-roll-submit"
          type="button"
          size="sm"
          disabled={disabled || expression.trim() === ""}
        >
          Roll
        </RollButton>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          data-testid="dice-roll-category"
          aria-label="Category"
          className={SELECT}
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
          className={cn(SELECT, "max-w-28")}
          value={selected?.value ?? ""}
          disabled={!live}
          onChange={(e) => setActor(e.target.value)}
        >
          {actors
            .filter((a) => !a.group)
            .map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          {(["Characters", "Tokens"] as const).map((g) => {
            const list = actors.filter((a) => a.group === g);
            return list.length === 0 ? null : (
              <optgroup key={g} label={g}>
                {list.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
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
          className="h-8 w-24 min-w-0 flex-1 text-xs"
          value={label}
          disabled={!live}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          data-testid="dice-roll-mode"
          data-value={mode}
          aria-label="Roll mode"
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
            >
              {MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {control.isDm && (
          <span className="flex items-center gap-1.5 text-xs">
            <Switch
              id={`${uid}-public`}
              data-testid="dice-roll-public"
              checked={control.publicValue}
              disabled={!live}
              onCheckedChange={control.setPublic}
            />
            <label htmlFor={`${uid}-public`}>Public</label>
          </span>
        )}
        {dmTools && <div className="ml-auto">{dmTools}</div>}
      </div>
      {/* #149: own row, away from Adv, so it is hard to flip by accident. */}
      <div className="flex items-center gap-1.5 border-t pt-1.5 text-xs text-muted-foreground">
        <Switch
          id={`${uid}-physical`}
          data-testid="dice-roll-physical"
          checked={physical}
          onCheckedChange={setPhysical}
        />
        <label htmlFor={`${uid}-physical`}>Physical dice: type in my own rolls</label>
      </div>
      {shownError && (
        <p data-testid="dice-roll-error" role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}

/** FR-DICE-07, #149: while physical mode is on, the top of the log says so (with a way out). */
function PhysicalBanner() {
  const [physical, setPhysical] = usePhysicalDice();
  if (!physical) return null;
  return (
    <div
      data-testid="dice-log-physical"
      role="status"
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs"
    >
      <HandIcon className="size-3.5 shrink-0 text-warning" />
      <span className="flex-1">Physical dice on: rolls ask for your dice</span>
      <button
        type="button"
        data-testid="dice-log-physical-off"
        className="rounded-sm font-medium underline-offset-2 hover:underline"
        onClick={() => setPhysical(false)}
      >
        Turn off
      </button>
    </div>
  );
}

/** The `dice.log` window body. `dmTools`: the DM's settings gear (FR-DICE-22). */
export function GameLog({ dmTools }: { dmTools?: ReactNode }) {
  const records = useRecords<GameLogEntryView>(GAME_LOG_ENTRY_TYPE);
  const everLive = useSync((s) => s.everLive);
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const entries = useMemo(() => sortEntries(records), [records]);
  return (
    <section
      data-testid="dice-log"
      aria-label="Game log"
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <PhysicalBanner />
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
        <EntryList entries={entries} isDm={isDm} />
      )}
      <RollBar dmTools={isDm ? dmTools : undefined} />
    </section>
  );
}
