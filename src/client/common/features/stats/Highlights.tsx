// Fight tab Highlights (FR-STATS-31, -35, -36): a Collapsible `stats-highlights` above the Fight
// table, two columns from a 400-px window; items `stats-highlight` (`data-record-id` = the
// FR-STATS-31 key) in the ack's order, empty ones left out. Kills / Downs read as the feed
// (`feedText`, FR-STATS-27): ≤ 20, then "+N". Renders only the ack: a player's never holds a hidden
// side, an amount or Still standing (FR-STATS-47).
import { feedText } from "@shared/stats/feed";
import type { DmHighlights, PlayerHighlights } from "@shared/stats/schemas";
import { ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/menus";
import { cn } from "../../lib/utils";
import { type ColorPerson, useColorOf } from "../campaign-management/colors";
import { HIGHLIGHT_TITLE, type HighlightItem, highlightDetailText, highlightItems } from "./logic";

const Hidden = () => (
  <EyeOffIcon
    data-testid="stats-highlight-hidden"
    aria-label="Hidden"
    className="ml-0.5 inline size-3 text-muted-foreground"
  />
);

function Winners({ item }: { item: Extract<HighlightItem, { kind: "stat" }> }) {
  const colorOf = useColorOf();
  return (
    <>
      {item.stat.winners.map((w, i) => {
        const person: ColorPerson = w.playerId
          ? { role: "player", playerId: w.playerId }
          : { role: "dm" };
        return (
          <span key={w.key}>
            {i > 0 ? ", " : ""}
            <span
              data-testid="stats-highlight-winner"
              data-record-id={w.key}
              style={{ color: colorOf(person) ?? undefined }}
            >
              {w.with ? [w.name, ...w.with].join(" + ") : w.name}
            </span>
            {"hidden" in w && w.hidden ? <Hidden /> : null}
          </span>
        );
      })}
      {item.stat.more ? (
        <span className="text-muted-foreground"> +{item.stat.more} more</span>
      ) : null}
    </>
  );
}

function Item({ item }: { item: HighlightItem }) {
  const wide = item.kind === "fell" || item.kind === "standing";
  return (
    <li
      data-testid="stats-highlight"
      data-record-id={item.key}
      className={cn("flex min-w-0 flex-col wrap-anywhere", wide && "col-span-full")}
    >
      <span className="text-muted-foreground">{HIGHLIGHT_TITLE[item.key]}</span>
      {item.kind === "stat" ? (
        <>
          <span>
            <Winners item={item} />
            <span className="tabular-nums"> · {item.value}</span>
          </span>
          {highlightDetailText(item.stat) ? (
            <span data-testid="stats-highlight-detail" className="text-muted-foreground">
              {highlightDetailText(item.stat)}
            </span>
          ) : null}
        </>
      ) : item.kind === "fell" ? (
        <span className="flex flex-col">
          {item.list.events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log order; one fact may repeat (a revive).
            <span key={i} data-testid="stats-highlight-event">
              {feedText(e)}
            </span>
          ))}
          {item.list.more ? <span className="text-muted-foreground">+{item.list.more}</span> : null}
        </span>
      ) : item.kind === "standing" ? (
        <span>
          {item.sides.map((s, i) => (
            <span key={s.key} data-testid="stats-highlight-side" data-record-id={s.key}>
              {i > 0 ? ", " : ""}
              {s.name}
              {s.hidden ? <Hidden /> : null}
            </span>
          ))}
        </span>
      ) : (
        <span className="tabular-nums">{item.text}</span>
      )}
    </li>
  );
}

export function Highlights({
  highlights,
  open,
  onOpenChange,
}: {
  highlights: PlayerHighlights | DmHighlights;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const items = highlightItems(highlights);
  if (items.length === 0) return null;
  return (
    <Collapsible
      data-testid="stats-highlights"
      open={open}
      onOpenChange={onOpenChange}
      className="flex shrink-0 flex-col gap-1 rounded-md border p-1.5 text-xs"
    >
      <CollapsibleTrigger
        data-testid="stats-highlights-toggle"
        className="flex items-center gap-1 text-left font-medium"
      >
        <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        Highlights
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Two columns from a 400-px window (the board is the body less 2 × 12 px). */}
        <ul className="grid grid-cols-1 gap-x-3 gap-y-1 @min-[376px]:grid-cols-2">
          {items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
