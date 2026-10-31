// `dice.details` "Roll details" body, both clients (FR-DICE-106–109). Reads the entry from the
// synced store only, so a player gets only redacted data; an entry that isn't there (hidden, or
// fell out of the window) is the same empty state as no pick, so it never hints a line was hidden.
// It reads at a glance: one equation row with a big total and a loud outcome, the expression said
// once, a one-row footer. Held (FR-DICE-40): blank dice and no totals until the landing.
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import type { DiceLook } from "@shared/dice-extras/looks";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  CATEGORY_LABEL,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
} from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord } from "@shared/entities/schemas";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import { type ComponentType, useMemo } from "react";
import { Medallion } from "../../components/kit/medallion";
import { ResultBox } from "../../components/kit/result-box";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { DieShape } from "../dice-extras/DieShape";
import { useLanded } from "../dice-extras/landing";
import { useRollDetails } from "./details";
import {
  type DetailLine,
  type DetailOutcome,
  type DetailSection,
  detailSections,
  detailWhat,
  entryPhysical,
  lineWithoutActor,
  termText,
} from "./details-model";
import { focusLogEntry } from "./focus";
import { Segment, useRollerLooks } from "./GameLog";
import { actorPortraits, HELD_TEXT, heldSegments } from "./logic";
import { rollerColorKey, useColorKeyOf } from "./name-color";

const TONE: Record<DetailOutcome["tone"], string> = {
  good: "text-hp-full",
  bad: "text-destructive",
  plain: "",
};

const CHIP = "px-1 py-0 text-[10px]";

/** FR-DICE-107: one die, in the equation; dropped struck through. Held: blank, no `data-value`. */
function DetailDie({ s, look, held }: { s: LineSegment; look: DiceLook; held: boolean }) {
  const d = s.die;
  if (!d) return <span className="text-2xl font-semibold">{s.text.trim()}</span>;
  const Wrap = d.kept ? "span" : "s";
  return (
    <Wrap
      data-testid="dice-details-die"
      data-faces={d.faces ?? ""}
      data-value={held ? undefined : d.value}
      data-kept={d.kept}
      className="inline-block leading-none"
    >
      <DieShape
        faces={d.faces}
        value={d.value}
        kept={d.kept}
        offered={d.offered === true}
        look={look}
        size="xl"
        blank={held}
        label={`${d.faces ? `d${d.faces}` : "dice"}: ${held ? HELD_TEXT : s.text}`}
      />
    </Wrap>
  );
}

/** "+ 2 Bless": the value, then its name. */
function Line({ line, held }: { line: DetailLine; held: boolean }) {
  return (
    <li data-testid="dice-details-line" className="flex gap-1.5 text-sm">
      <span className="shrink-0 font-medium tabular-nums">
        {held && line.rolled ? HELD_TEXT : line.value}
      </span>
      <span className="min-w-0 break-words text-muted-foreground">{line.label}</span>
    </li>
  );
}

/** `[die] [die] + 2 = 17`, wrapping for many dice: the total stays with the last die. */
function Equation({ s, look, held }: { s: DetailSection; look: DiceLook; held: boolean }) {
  const last = s.dice.at(-1);
  const total = (
    <ResultBox
      data-testid="dice-details-total"
      data-hit={s.hit && !held ? "true" : undefined}
      value={s.total}
      outcome={s.outcome}
      held={held}
      size="lg"
      className={cn("h-14 min-w-16 px-2.5 text-4xl", s.hit && !held && "text-hp-full")}
    />
  );
  return (
    <div
      data-testid="dice-details-equation"
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      {s.dice.slice(0, -1).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
        <DetailDie key={i} s={c} look={look} held={held} />
      ))}
      <span className="flex items-center gap-2 whitespace-nowrap">
        {last && <DetailDie s={last} look={look} held={held} />}
        {s.terms.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: terms are positional and immutable
          <span key={i} data-testid="dice-details-term" className="text-2xl font-semibold">
            {held && t.rolled ? HELD_TEXT : termText(t.value)}
          </span>
        ))}
        {last && <span className="text-2xl font-semibold">=</span>}
        {total}
      </span>
      {!held &&
        s.outcomes.map((o) => (
          <span
            key={o.text}
            data-testid="dice-details-outcome"
            data-tone={o.tone}
            className={cn("text-xl font-bold", TONE[o.tone])}
          >
            {o.text}
          </span>
        ))}
    </div>
  );
}

/** "1d20+2 · Advantage": the expression as typed, said once. */
function Said({ s, held }: { s: DetailSection; held: boolean }) {
  const mode = held ? null : s.mode;
  if (!s.expression && !mode) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {s.expression && (
        <span data-testid="dice-details-expression" className="font-mono">
          {s.expression}
        </span>
      )}
      {s.expression && mode && " · "}
      {mode && <span data-testid="dice-details-mode">{mode}</span>}
    </span>
  );
}

function Section({
  s,
  look,
  held,
  several,
}: {
  s: DetailSection;
  look: DiceLook;
  held: boolean;
  /** Several rolls on the line: a short heading per roll. One has no chrome. */
  several: boolean;
}) {
  return (
    <section
      data-testid="dice-details-roll"
      data-record-id={s.rollId ?? s.key}
      className="flex flex-col gap-1.5"
    >
      {several && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h4 data-testid="dice-details-heading" className="text-sm font-semibold">
            {s.heading}
          </h4>
          <Said s={s} held={held} />
        </div>
      )}
      <Equation s={s} look={look} held={held} />
      {s.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {s.lines.map((l) => (
            <Line key={l.key} line={l} held={held} />
          ))}
        </ul>
      )}
      {s.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.tags.map((t) => (
            <Badge key={t} data-testid="dice-details-tag" variant="outline" className={CHIP}>
              {t}
            </Badge>
          ))}
        </div>
      )}
      {!held && s.offered.length > 0 && (
        <div data-testid="dice-details-offered" className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Offered, not in the total</span>
          <ul className="flex flex-col gap-0.5">
            {s.offered.map((l) => (
              <Line key={l.key} line={l} held={false} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Header({
  actor,
  what,
  portrait,
  color,
  said,
}: {
  actor: string;
  what: string | null;
  portrait: string | null;
  color: string | null;
  said?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-2">
      <Medallion name={actor} imageAssetId={portrait} colour={color} size="lg" />
      <div className="flex min-w-0 flex-col">
        <h3 data-testid="dice-details-title" className="break-words text-base leading-tight">
          <strong
            data-testid="dice-details-actor"
            className="font-semibold"
            style={color ? { color } : undefined}
          >
            {actor}
          </strong>
          {what && (
            <span data-testid="dice-details-what" className="text-muted-foreground">
              {" · "}
              {what}
            </span>
          )}
        </h3>
        {said}
      </div>
    </header>
  );
}

function Body({
  e,
  Extras,
}: {
  e: GameLogEntryView;
  Extras?: ComponentType<{ e: GameLogEntryView }> | undefined;
}) {
  const landed = useLanded(e.id);
  const look = useRollerLooks()(e);
  const key = rollerColorKey(useColorKeyOf(), e);
  const color = key ? colorHex(key) : null;
  const entities = useRecords<EntityRecord>(ENTITY_TYPE);
  const combatants = useRecords<CombatantRecord>(COMBATANT_TYPE);
  const tokens = useRecords<TokenView>(TOKEN_TYPE);
  const portrait = useMemo(
    () => actorPortraits({ entities, combatants, tokens }).get(e.actorName.toLowerCase()) ?? null,
    [entities, combatants, tokens, e.actorName],
  );
  const sections = useMemo(() => detailSections(e), [e]);
  const line = useMemo(() => {
    const { segments } = formatEntry(e);
    return lineWithoutActor(landed ? segments : heldSegments(segments));
  }, [e, landed]);
  const rerolled = e.supersededBy !== null && !e.undone ? e.supersededBy : null;
  const one = sections.length === 1 ? sections[0] : undefined;
  return (
    <div
      data-testid="dice-details"
      data-record-id={e.id}
      data-landed={landed}
      className="flex flex-col gap-2"
    >
      {sections.length > 0 ? (
        <>
          <Header
            actor={e.actorName}
            what={detailWhat(e, sections)}
            portrait={portrait}
            color={color}
            said={one && <Said s={one} held={!landed} />}
          />
          {sections.map((s) => (
            <Section key={s.key} s={s} look={look} held={!landed} several={sections.length > 1} />
          ))}
        </>
      ) : (
        <>
          {line.actor !== null && (
            <Header actor={line.actor} what={null} portrait={portrait} color={color} />
          )}
          <p data-testid="dice-details-text" className="break-words text-base">
            {line.rest.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
              <Segment key={i} s={s} look={look} nameColor={null} />
            ))}
          </p>
        </>
      )}
      <footer className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <span data-testid="dice-details-category">{CATEGORY_LABEL[e.category]}</span>
        <span aria-hidden>·</span>
        <time data-testid="dice-details-time" dateTime={e.at}>
          {new Date(e.at).toLocaleTimeString()}
        </time>
        {landed && Extras && <Extras e={e} />}
        {entryPhysical(e) && (
          <Badge data-testid="dice-details-physical" variant="outline" className={CHIP}>
            physical
          </Badge>
        )}
        {e.undone && (
          <Badge data-testid="dice-details-undone" variant="outline" className={CHIP}>
            undone
          </Badge>
        )}
        {rerolled && (
          <button
            type="button"
            data-testid="dice-details-rerolled"
            data-record-id={rerolled}
            className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => focusLogEntry(rerolled)}
          >
            rerolled: show the new roll
          </button>
        )}
      </footer>
    </div>
  );
}

/** FR-DICE-106: `Extras`: the DM's facts, in the footer (FR-DICE-108); the player's has none. */
export function RollDetails({ Extras }: { Extras?: ComponentType<{ e: GameLogEntryView }> }) {
  const entryId = useRollDetails((s) => s.entryId);
  const entry = useRecords<GameLogEntryView>(GAME_LOG_ENTRY_TYPE).find((x) => x.id === entryId);
  if (!entry) {
    return (
      <p
        data-testid="dice-details-empty"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Pick a roll in the log
      </p>
    );
  }
  return <Body key={entry.id} e={entry} Extras={Extras} />;
}
