// Feature use with a cost (class-resources FR-CRES-09–12), sheet side: the per-browser "show in
// the log" switch, the Use button (ask amount, slot level, overspend confirm), the editor's spend
// fields. The game-log Undo action is `undo-action.ts`.
import { pactMax } from "@shared/character-sheet/counters";
import { spendMissing, spendText } from "@shared/character-sheet/resource-use";
import type { ResourceUsePayload } from "@shared/character-sheet/resource-use-kind";
import {
  CHARX_INTENTS,
  type FeatureRow,
  SPEND_AMOUNT_MAX,
  type SpendLink,
} from "@shared/character-sheet/sheet";
import { pointsLeft, slotsLeft } from "@shared/character-sheet/sorcery";
import { SPELL_LEVELS } from "@shared/entities/schemas";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/ui/button";
import {
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "../../components/ui/controls";
import { Input } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { IntField, SelectField, useBusy } from "./fields";
import { useSheet, useSheetIntents } from "./sheet-context";
import { levelOrdinal } from "./view-model";

// ---------- FR-CRES-12: per-browser public switch ----------

const listeners = new Set<() => void>();
const keyOf = (characterId: string) => `pp.cres.v1.public.${characterId}`;

function readPublic(characterId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(keyOf(characterId)) !== "0";
  } catch {
    return true;
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("pp.cres.v1.")) fn();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** `[public, set]`: whether this browser's resource-use lines for the character are public. */
export function useResourcePublic(characterId: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribe,
    () => readPublic(characterId),
    () => true,
  );
  const set = useCallback(
    (v: boolean) => {
      try {
        globalThis.localStorage?.setItem(keyOf(characterId), v ? "1" : "0");
      } catch {
        // Storage unavailable: the switch just doesn't stick.
      }
      for (const fn of [...listeners]) fn();
    },
    [characterId],
  );
  return [on, set];
}

/** FR-CRES-12: "Show resource use in the game log" (on = everyone; off = the DM and you). */
export function ResourcePublicSwitch() {
  const ctx = useSheet();
  const [on, set] = useResourcePublic(ctx.creature.id);
  if (ctx.creature.kind !== "character" || !ctx.canCount) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        data-testid="cres-public"
        aria-label="Show resource use to everyone"
        checked={on}
        onCheckedChange={(v) => set(v === true)}
      />
      {on ? "Resource use: everyone sees it" : "Resource use: only the DM and you"}
    </span>
  );
}

// ---------- FR-CRES-10, -11: the Use button ----------

/** FR-CRES-10: Use on a row with a spend link (view mode; owner and DM, also locked). */
export function UseButton({ f }: { f: FeatureRow }) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const [pub] = useResourcePublic(ctx.creature.id);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const link = f.spend;
  if (!link) return null;
  const counters = ctx.creature.kind === "character" && ctx.canCount;
  const missing = spendMissing(ctx.sheet, link);
  const cost = spendText(ctx.sheet, link);
  const from = link.from;
  const src = "feature" in from ? ctx.sheet.features.find((r) => r.id === from.feature) : undefined;
  const fixed = link.amount === "ask" ? null : link.amount;
  const ask = link.amount === "ask";
  const anySlot = "slot" in from;
  const levels = anySlot
    ? SPELL_LEVELS.filter((l) => slotsLeft(ctx.sheet, ctx.stats, l) >= (fixed ?? 1))
    : [];
  const pactFree = pactMax(ctx.stats) - ctx.sheet.pactUsed;
  const n = fixed ?? Number(amount);
  const short = src ? pointsLeft(src) < n : "pact" in from ? pactFree < n : false;
  const own = f.usesMax ? pointsLeft(f) < 1 : false;
  const needsPop = ask || anySlot || (src !== undefined && (short || own)) || own;
  const send = (extra: object) =>
    busy.run(() =>
      intents
        .send(CHARX_INTENTS.useFeature, {
          characterId: ctx.creature.id,
          rowId: f.id,
          ...(pub ? {} : { public: false }),
          ...extra,
        })
        .then(() => setOpen(false)),
    );
  const off = !live || busy.busy || !counters || missing;
  const button = (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px]"
      data-testid="cres-feature-use"
      data-record-id={f.id}
      disabled={
        off || ("pact" in from && pactFree < (fixed ?? 1)) || (anySlot && levels.length === 0)
      }
      onClick={needsPop ? undefined : () => send({})}
    >
      Use
    </Button>
  );
  return (
    <span className="flex items-center gap-1.5">
      <span
        data-testid="cres-feature-cost"
        data-record-id={f.id}
        className="text-[10px] text-muted-foreground"
      >
        {missing ? "Spend source missing" : cost}
      </span>
      {!counters ? null : !needsPop ? (
        button
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{button}</PopoverTrigger>
          <PopoverContent
            data-testid="cres-use-popover"
            className="flex w-60 flex-col gap-2 p-2 text-xs"
          >
            <span className="font-medium">{f.name}</span>
            {ask && (
              <span className="flex items-center gap-2">
                Amount
                <Input
                  data-testid="cres-use-amount"
                  aria-label="Amount"
                  type="number"
                  min={1}
                  max={SPEND_AMOUNT_MAX}
                  value={amount}
                  className="h-7 w-16"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </span>
            )}
            {(short || own) && (
              <span data-testid="cres-use-short">
                Not enough left. Use anyway? It goes below zero.
              </span>
            )}
            {anySlot ? (
              <div className="flex flex-wrap gap-1">
                {levels.length === 0 && <span className="text-muted-foreground">No slot left</span>}
                {levels.map((l) => (
                  <Button
                    key={l}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    data-testid="cres-use-slot"
                    data-value={l}
                    disabled={!live || busy.busy || !(n >= 1)}
                    onClick={() => send({ slotLevel: Number(l), ...(ask ? { amount: n } : {}) })}
                  >
                    {levelOrdinal(l)}
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                size="sm"
                data-testid="cres-use-confirm"
                disabled={!live || busy.busy || !(n >= 1 && n <= SPEND_AMOUNT_MAX)}
                onClick={() =>
                  send({
                    ...(ask ? { amount: n } : {}),
                    ...(short || own ? { overspend: true } : {}),
                  })
                }
              >
                {short || own ? "Use anyway" : "Use"}
              </Button>
            )}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

// ---------- FR-CRES-09: editor fields ----------

const NONE = "";
type SourceValue = "" | "pact" | "slot" | `feature:${string}`;

const sourceValue = (link: SpendLink | undefined): SourceValue =>
  !link
    ? NONE
    : "pact" in link.from
      ? "pact"
      : "slot" in link.from
        ? "slot"
        : `feature:${link.from.feature}`;

/** FR-CRES-09: "Spends" (a row with uses, a pact slot, any slot) + cost or "Ask each time". */
export function SpendFields({
  f,
  put,
}: {
  f: FeatureRow;
  put(p: Partial<FeatureRow>): Promise<unknown>;
}) {
  const ctx = useSheet();
  const link = f.spend;
  const options: { value: SourceValue; label: string }[] = [
    { value: NONE, label: "Spends nothing" },
    ...ctx.sheet.features
      .filter((r) => r.id !== f.id && r.usesMax)
      .map((r) => ({ value: `feature:${r.id}` as SourceValue, label: `Spends ${r.name}` })),
    { value: "pact", label: "Spends a pact slot" },
    { value: "slot", label: "Spends a spell slot" },
  ];
  const commitSource = (v: SourceValue | null) => {
    if (!v) return put({ spend: undefined });
    const from: SpendLink["from"] =
      v === "pact" ? { pact: true } : v === "slot" ? { slot: "any" } : { feature: v.slice(8) };
    return put({ spend: { from, amount: link?.amount ?? 1 } });
  };
  return (
    <>
      <SelectField
        path={`features.${f.id}.spend`}
        label="Spends"
        value={sourceValue(link) || null}
        options={options}
        commit={commitSource}
      />
      {link && link.amount !== "ask" && (
        <IntField
          path={`features.${f.id}.spend.amount`}
          label="Cost"
          value={link.amount}
          min={1}
          max={SPEND_AMOUNT_MAX}
          commit={(n) => put({ spend: { ...link, amount: n ?? 1 } })}
        />
      )}
      {link && (
        <span className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            data-testid="cres-spend-ask"
            data-record-id={f.id}
            aria-label="Ask the amount each time"
            checked={link.amount === "ask"}
            onCheckedChange={(on) => put({ spend: { ...link, amount: on === true ? "ask" : 1 } })}
          />
          Ask each time
        </span>
      )}
    </>
  );
}

export type { ResourceUsePayload };
