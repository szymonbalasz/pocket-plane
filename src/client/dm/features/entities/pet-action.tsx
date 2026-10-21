// Creatures window row action **Make pet…** (FR-ENT-32 UI, sprint 6): on every monster row
// (imported, custom or another pet) opens the pet Dialog prefilled with that creature. FR-ENT-43
// (sim-10): on a pet row it reads "Copy as a new pet…" (the pet stays; a new one is made from it).
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import { HeartHandshakeIcon } from "lucide-react";
import { useState } from "react";
import type { CreatureAction } from "./creature-actions";
import type { CreatureRow } from "./list";
import { PetDialog } from "./pet-dialog";

/** FR-ENT-32 / -43: the action's label and accessible name for a row. */
export function petActionLabel(row: Pick<CreatureRow, "name" | "pet">) {
  return row.pet
    ? { label: "Copy as a new pet…", aria: `Copy ${row.name} as a new pet` }
    : { label: "Make pet…", aria: `Make pet from ${row.name}` };
}

function MakePetAction({ row }: { row: CreatureRow }) {
  const [open, setOpen] = useState(false);
  if (row.kind !== "monster") return null;
  const { label, aria } = petActionLabel(row);
  return (
    <>
      <Tooltip content={label}>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="ent-pet-make"
          data-record-id={row.id}
          aria-label={aria}
          onClick={() => setOpen(true)}
        >
          <HeartHandshakeIcon className="size-3.5" />
        </Button>
      </Tooltip>
      <PetDialog
        open={open}
        onOpenChange={setOpen}
        base={{ id: row.id, name: row.name, badge: row.badge }}
      />
    </>
  );
}

export const petCreatureAction: CreatureAction = {
  placement: "row",
  id: "ent.make-pet",
  component: MakePetAction,
};
