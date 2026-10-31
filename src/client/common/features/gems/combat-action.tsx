// FR-GEM-34 (GM2): the "Combat gem" card action (`card-actions.ts`, FR-CBT-130) on the owner's
// pending damage card and in the DM's attack popup while the card can take it (pending with damage,
// not maxed, ≥ 1 Combat gem held; gems on). "Combat gem" opens an inline die picker: one chip per
// weapon die (base and extra parts, never mods / triggers), up to the level limit (1 / 2 / 3,
// FR-GEM-26); a part entered as a physical total asks for each die first (FR-GEM-28, OQ-GEM-13 A).
// "Spend" is the one confirm (FR-GEM-17); a reject shows inline (`gem-error`). Picker state is
// client memory: a disconnect closes it (nothing sent, CBT §11).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import type { CardPartRef } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import type { CardAction, CardClient } from "../combat-tracker/card-actions";
import {
  canMax,
  cardCharacter,
  combatAvailable,
  combatPayload,
  dieKey,
  openCard,
  type PickDie,
  type PickPart,
  pickLimit,
  pickParts,
  typedDice,
} from "./combat-model";
import { useGemIntent } from "./GemBlock";
import { GemIcon } from "./GemCounts";

type Picked = { part: CardPartRef; index: number };

function DieChip({
  d,
  value,
  picked,
  full,
  disabled,
  onToggle,
}: {
  d: PickDie;
  value: number | null;
  picked: boolean;
  full: boolean;
  disabled: boolean;
  onToggle(): void;
}) {
  const open = canMax(d, value);
  const state = picked ? "picked" : !d.kept ? "dropped" : open ? "open" : "max";
  const faces = d.faces === null ? "" : `d${d.faces} `;
  return (
    <Button
      type="button"
      size="sm"
      variant={picked ? "default" : "outline"}
      data-testid="gem-combat-die"
      data-part={d.part}
      data-index={d.index}
      data-state={state}
      aria-pressed={picked}
      aria-label={`${faces}${value ?? "?"}${picked ? ", set to max" : ""}`}
      disabled={disabled || !open || (!picked && full)}
      onClick={onToggle}
      className="h-6 px-1.5 font-mono text-xs tabular-nums"
    >
      <span className="text-[10px] opacity-70">{faces}</span>
      {picked && d.faces !== null ? `${value ?? "?"} → ${d.faces}` : (value ?? "?")}
    </Button>
  );
}

/** FR-GEM-28: a physical total's dice, typed one by one before they can be picked. */
function KnownInputs({
  part,
  texts,
  disabled,
  onChange,
}: {
  part: PickPart;
  texts: readonly string[];
  disabled: boolean;
  onChange(texts: string[]): void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground">Enter each die</span>
      {part.dice.map((d) => (
        <Input
          key={d.index}
          data-testid="gem-combat-known"
          data-part={part.part}
          data-index={d.index}
          aria-label={`${d.faces === null ? "Die" : `d${d.faces}`} ${d.index + 1}`}
          inputMode="numeric"
          className="h-6 w-10 px-1 text-xs"
          disabled={disabled}
          value={texts[d.index] ?? ""}
          onChange={(e) => {
            const next = [...texts];
            next[d.index] = e.target.value;
            onChange(next);
          }}
        />
      ))}
    </span>
  );
}

function CombatGemPicker({ card, close }: { card: NotificationRecord; close(): void }) {
  const store = useSync((s) => s.store);
  const { send, error, disabled } = useGemIntent();
  const p = openCard(card);
  const you = store.you;
  const ch = p && you ? cardCharacter(store, p, you) : null;
  const parts = p ? pickParts(store, p) : [];
  const [picked, setPicked] = useState<Picked[]>([]);
  const [typed, setTyped] = useState<Record<string, string[]>>({});
  if (!p || !ch) return null;
  const { limit, next } = pickLimit(ch.level);
  const multi = parts.length > 1;
  const known: { part: CardPartRef; dice: number[] }[] = [];
  const rows = parts.map((part) => {
    const total = part.dice.some((d) => d.value === null);
    const texts = typed[String(part.part)] ?? [];
    const entered = total ? typedDice(part, texts) : null;
    if (entered && "values" in entered) known.push({ part: part.part, dice: entered.values });
    const values = entered && "values" in entered ? entered.values : part.dice.map((d) => d.value);
    return { part, total, texts, entered, values };
  });
  const full = picked.length >= limit;
  const toggle = (d: Picked) =>
    setPicked((xs) =>
      xs.some((x) => dieKey(x) === dieKey(d))
        ? xs.filter((x) => dieKey(x) !== dieKey(d))
        : xs.length < limit
          ? [...xs, d]
          : xs,
    );
  const spend = async () => {
    const intent = combatPayload(ch.id, card.id, picked, known);
    if (await send(intent.name, intent.payload)) close();
  };
  return (
    <div
      data-testid="gem-combat-picker"
      data-record-id={card.id}
      className="flex w-full flex-col gap-1.5 rounded-md border p-1.5"
    >
      {rows.map(({ part, total, texts, entered, values }) => (
        <div key={String(part.part)} className="flex flex-wrap items-center gap-1">
          {multi && part.type && (
            <span className="min-w-14 text-xs text-muted-foreground">{part.type}</span>
          )}
          {total && !(entered && "values" in entered) ? (
            <>
              <KnownInputs
                part={part}
                texts={texts}
                disabled={disabled}
                onChange={(t) => setTyped((x) => ({ ...x, [String(part.part)]: t }))}
              />
              {entered && "error" in entered && (
                <span data-testid="gem-combat-known-error" className="text-xs text-destructive">
                  {entered.error}
                </span>
              )}
            </>
          ) : (
            part.dice.map((d) => (
              <DieChip
                key={d.index}
                d={d}
                value={values[d.index] ?? null}
                picked={picked.some((x) => dieKey(x) === dieKey(d))}
                full={full}
                disabled={disabled}
                onToggle={() => toggle({ part: d.part, index: d.index })}
              />
            ))
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          data-testid="gem-combat-submit"
          className="h-6 px-2 text-xs"
          disabled={disabled || picked.length === 0}
          onClick={() => void spend()}
        >
          Spend ({picked.length}/{limit})
        </Button>
        <Tip content="Cancel">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid="gem-combat-cancel"
            aria-label="Cancel"
            className="size-6"
            onClick={close}
          >
            <XIcon className="size-3.5" />
          </Button>
        </Tip>
        {next && <span className="text-xs text-muted-foreground">{next}</span>}
      </div>
      {error && (
        <p data-testid="gem-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** FR-GEM-34: "Combat gem" → the inline die picker. */
function CombatGem({ card }: { card: NotificationRecord; client: CardClient }) {
  const live = useSync((s) => s.state === "live");
  const [open, setOpen] = useState(false);
  // CBT §11: a disconnect mid-pick sends nothing and closes the picker (the card is unchanged).
  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);
  if (open) return <CombatGemPicker card={card} close={() => setOpen(false)} />;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-testid="gem-combat"
      data-record-id={card.id}
      aria-label="Combat gem: max damage dice"
      disabled={!live}
      className={cn("h-6 gap-1 px-2 text-xs")}
      onClick={() => setOpen(true)}
    >
      <GemIcon gem="combat" />
      Combat gem
    </Button>
  );
}

export const gemCombatAction: CardAction = {
  id: "gem.combat",
  order: 10,
  feature: GEMS_FEATURE,
  available: combatAvailable,
  Component: CombatGem,
};
