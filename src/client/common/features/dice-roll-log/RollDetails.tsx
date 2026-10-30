// `dice.details` "Roll details" body, both clients (FR-DICE-106–109). Reads the entry from the
// synced store only, so a player gets only redacted data; an entry that isn't there (hidden, or
// fell out of the window) is the same empty state as no pick, so it never hints a line was hidden.
// Held (FR-DICE-40): blank dice and no totals until the landing, as the row's Tooltip.

import type { DiceLook } from "@shared/dice-extras/looks";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { rowAction } from "@shared/dice-roll-log/row";
import {
  CATEGORY_LABEL,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
} from "@shared/dice-roll-log/schemas";
import { type ComponentType, useMemo } from "react";
import { ResultBox } from "../../components/kit/result-box";
import { Badge } from "../../components/ui/primitives";
import { useRecords } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { DieShape } from "../dice-extras/DieShape";
import { useLanded } from "../dice-extras/landing";
import { useRollDetails } from "./details";
import {
  type DetailLine,
  type DetailSection,
  detailSections,
  entryPhysical,
} from "./details-model";
import { focusLogEntry } from "./focus";
import { Segment, useRollerLooks } from "./GameLog";
import { HELD_TEXT, heldSegments } from "./logic";
import { rollerColorKey, useColorKeyOf } from "./name-color";

/** FR-DICE-107: one die, large; dropped struck through. Held: blank, no `data-value`. */
function DetailChip({ s, look, held }: { s: LineSegment; look: DiceLook; held: boolean }) {
  const d = s.die;
  if (!d) {
    const text = s.text.trim();
    return text ? <span className="text-muted-foreground">{text}</span> : null;
  }
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
        size="lg"
        blank={held}
        label={`${d.faces ? `d${d.faces}` : "dice"}: ${held ? HELD_TEXT : s.text}`}
      />
    </Wrap>
  );
}

function Line({ line, held }: { line: DetailLine; held: boolean }) {
  return (
    <li data-testid="dice-details-line" className="flex justify-between gap-3 text-sm">
      <span className="min-w-0 break-words text-muted-foreground">{line.label}</span>
      <span className="shrink-0 tabular-nums">{held && line.rolled ? HELD_TEXT : line.value}</span>
    </li>
  );
}

function Section({ s, look, held }: { s: DetailSection; look: DiceLook; held: boolean }) {
  return (
    <section
      data-testid="dice-details-roll"
      data-record-id={s.rollId ?? s.key}
      className="flex flex-col gap-2 rounded-md border p-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="min-w-0 break-words text-sm font-semibold">{s.title}</h4>
        {s.expression && (
          <span
            data-testid="dice-details-expression"
            className="font-mono text-xs text-muted-foreground"
          >
            {s.expression}
          </span>
        )}
        {!held && s.mode && (
          <Badge
            data-testid="dice-details-mode"
            variant="outline"
            className="px-1 py-0 text-[10px]"
          >
            {s.mode}
          </Badge>
        )}
        {s.tags.map((t) => (
          <Badge
            key={t}
            data-testid="dice-details-tag"
            variant="outline"
            className="px-1 py-0 text-[10px] text-muted-foreground"
          >
            {t}
          </Badge>
        ))}
      </div>
      {s.chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {s.chips.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
            <DetailChip key={i} s={c} look={look} held={held} />
          ))}
        </div>
      )}
      {s.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {s.lines.map((l) => (
            <Line key={l.key} line={l} held={held} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <ResultBox
          data-testid="dice-details-total"
          value={s.total}
          outcome={s.outcome}
          held={held}
          size="lg"
          className="h-11 min-w-16 text-3xl"
        />
        {!held && s.outcomeText && (
          <span data-testid="dice-details-outcome" className="text-sm font-medium">
            {s.outcomeText}
          </span>
        )}
      </div>
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
      {!held && s.note && (
        <p data-testid="dice-details-note" className="text-sm italic text-muted-foreground">
          {s.note}
        </p>
      )}
    </section>
  );
}

/** FR-DICE-107: "cbt.hp", gem lines and the rest: the full line, wrapped. */
function FullLine({ e, held, look }: { e: GameLogEntryView; held: boolean; look: DiceLook }) {
  const shown = useMemo(() => {
    const { segments } = formatEntry(e);
    return held ? heldSegments(segments) : segments;
  }, [e, held]);
  return (
    <p data-testid="dice-details-text" className="break-words text-sm">
      {shown.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and immutable
        <Segment key={i} s={s} look={look} nameColor={null} />
      ))}
    </p>
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
  const color = rollerColorKey(useColorKeyOf(), e);
  const sections = useMemo(() => detailSections(e), [e]);
  const row = useMemo(() => rowAction(e), [e]);
  const rerolled = e.supersededBy !== null && !e.undone ? e.supersededBy : null;
  return (
    <div
      data-testid="dice-details"
      data-record-id={e.id}
      data-landed={landed}
      className="flex flex-col gap-2"
    >
      {row.actor !== null && (
        <h3 data-testid="dice-details-title" className="break-words text-sm">
          <strong
            data-testid="dice-details-actor"
            className="font-semibold"
            style={color ? { color: colorHex(color) } : undefined}
          >
            {row.actor}
          </strong>
          {sections.length === 0 ? "" : ` · ${row.text}`}
        </h3>
      )}
      {sections.length > 0 ? (
        sections.map((s) => <Section key={s.key} s={s} look={look} held={!landed} />)
      ) : (
        <FullLine e={e} held={!landed} look={look} />
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Category</dt>
        <dd data-testid="dice-details-category">{CATEGORY_LABEL[e.category]}</dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd data-testid="dice-details-time">{new Date(e.at).toLocaleString()}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {entryPhysical(e) && (
          <Badge
            data-testid="dice-details-physical"
            variant="outline"
            className="px-1 py-0 text-[10px]"
          >
            physical
          </Badge>
        )}
        {e.undone && (
          <Badge
            data-testid="dice-details-undone"
            variant="outline"
            className="px-1 py-0 text-[10px]"
          >
            undone
          </Badge>
        )}
        {rerolled && (
          <button
            type="button"
            data-testid="dice-details-rerolled"
            data-record-id={rerolled}
            className="rounded-sm text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => focusLogEntry(rerolled)}
          >
            rerolled: show the new roll
          </button>
        )}
      </div>
      {landed && Extras && <Extras e={e} />}
    </div>
  );
}

/** FR-DICE-106: `Extras`: the DM's facts (FR-DICE-108); the player's window has none. */
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
