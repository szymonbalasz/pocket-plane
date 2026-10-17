// **Add to sheet** (FR-CMP-28, CMP §7), both clients, on spell / item / feature views: Popover with
// a character Select (DM: campaign characters; player: own) → `cmp.addToSheet` → Toast "Added
// to Mira's Features" (+ "and Triggers", or the #241 skip note). Disabled while not live (shell
// offline rule).
import { AddToSheetResult, CMP_INTENTS } from "@shared/compendium/homebrew";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Label } from "../../components/ui/primitives";
import { useRecords, useSync } from "../../sync/store";
import { useCbtIntent } from "../combat-tracker/store";
import { addedMessage, characterOptions } from "./add-to-sheet";

type EntityLike = Parameters<typeof characterOptions>[0][number];

export function AddToSheet({ entryId }: { entryId: string }) {
  const entities = useRecords<EntityLike>(ENTITY_TYPE);
  const you = useSync((s) => s.store.you);
  const options = useMemo(() => characterOptions(entities, you), [entities, you]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const { send, disabled } = useCbtIntent();
  const characterId = picked ?? (options.length === 1 ? (options[0]?.id ?? null) : null);
  if (options.length === 0) return null;

  const add = async () => {
    if (!characterId) return;
    const raw = await send(CMP_INTENTS.addToSheet, { entryId, characterId });
    if (raw === undefined) return;
    const r = AddToSheetResult.safeParse(raw);
    const name = options.find((o) => o.id === characterId)?.name ?? "the sheet";
    toast.success(r.success ? addedMessage(name, r.data) : `Added to ${name}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          data-testid="cmp-add-to-sheet"
          disabled={disabled}
        >
          <PlusIcon className="size-3.5" /> Add to sheet
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 space-y-2 p-3"
        data-testid="cmp-add-to-sheet-panel"
      >
        <Label className="text-xs">Character</Label>
        <Select value={characterId ?? ""} onValueChange={setPicked}>
          <SelectTrigger className="h-8" data-testid="cmp-add-to-sheet-character">
            <SelectValue placeholder="Pick a character" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id} data-value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-7"
            data-testid="cmp-add-to-sheet-confirm"
            disabled={disabled || !characterId}
            onClick={() => void add()}
          >
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
