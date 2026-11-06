// Flexible Casting (class-resources FR-CRES-06, -07): the sorcery-points row's "Convert" popover.
// "Slot → points" lists the levels with a slot left (created ones count) and the pact slots;
// "Points → slot" lists 1st–5th with their cost. Choices the server would refuse are disabled
// (points full, not enough points); the server still decides.

import { slotMax } from "@shared/character-sheet/counters";
import {
  CHARX_INTENTS,
  CREATED_SLOT_LEVELS,
  type FeatureRow,
  type SlotSource,
} from "@shared/character-sheet/sheet";
import { CREATE_SLOT_COST, pointsLeft, slotsLeft } from "@shared/character-sheet/sorcery";
import { SPELL_LEVELS } from "@shared/entities/schemas";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { useSync } from "../../sync/store";
import { useBusy } from "./fields";
import { useResourcePublic } from "./resource-use";
import { useSheet, useSheetIntents } from "./sheet-context";
import { levelOrdinal } from "./view-model";

export function ConvertMenu({ f }: { f: FeatureRow }) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const [open, setOpen] = useState(false);
  const [pub] = useResourcePublic(ctx.creature.id);
  const stats = ctx.stats;
  const left = pointsLeft(f);
  const spent = f.used;
  const pact = stats.spellcasting?.pact;
  const sources: { from: SlotSource; label: string; value: string; worth: number }[] = [
    ...SPELL_LEVELS.filter((l) => slotsLeft(ctx.sheet, stats, l) > 0).map((l) => ({
      from: { slot: Number(l) },
      label: `${levelOrdinal(l)} slot`,
      value: l,
      worth: Number(l),
    })),
    ...(pact && ctx.sheet.pactUsed < pact.slots
      ? [{ from: { pact: true as const }, label: "Pact slot", value: "pact", worth: pact.level }]
      : []),
  ];
  const run = (name: string, payload: object) =>
    busy.run(() =>
      intents
        .send(name, {
          characterId: ctx.creature.id,
          ...payload,
          ...(pub ? {} : { public: false }),
        })
        .then(() => setOpen(false)),
    );
  const off = !live || busy.busy;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          data-testid="cres-convert"
          data-record-id={f.id}
          disabled={off}
        >
          Convert
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="cres-convert-menu"
        className="flex w-64 flex-col gap-2 p-2 text-xs"
      >
        <span className="font-medium">Slot → sorcery points</span>
        {sources.length === 0 && <span className="text-muted-foreground">No slot left</span>}
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              data-testid="cres-convert-slot"
              data-value={s.value}
              disabled={off || spent - s.worth < 0}
              onClick={() => run(CHARX_INTENTS.convertSlot, { from: s.from })}
            >
              {s.label} → +{s.worth}
            </Button>
          ))}
        </div>
        {spent === 0 && <span className="text-muted-foreground">Sorcery points are full</span>}
        <span className="font-medium">Sorcery points → slot ({Math.max(0, left)} left)</span>
        <div className="flex flex-wrap gap-1">
          {CREATED_SLOT_LEVELS.map((l) => (
            <Button
              key={l}
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              data-testid="cres-create-slot"
              data-value={l}
              disabled={off || left < CREATE_SLOT_COST[l]}
              onClick={() => run(CHARX_INTENTS.createSlot, { level: Number(l) })}
            >
              {levelOrdinal(l)} −{CREATE_SLOT_COST[l]}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground">
          Created slots last until a long rest
          {slotMax(stats, "1") === 0 && !pact ? "; this sheet has no spell slots" : ""}.
        </span>
      </PopoverContent>
    </Popover>
  );
}
