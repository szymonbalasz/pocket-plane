// Creatures window row action **Make pet…** (FR-ENT-32 UI, sprint 6): on every monster row
// (imported, custom or another pet) opens the pet Dialog prefilled with that creature.
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import { HeartHandshakeIcon } from "lucide-react";
import { useState } from "react";
import type { CreatureAction } from "./creature-actions";
import type { CreatureRow } from "./list";
import { PetDialog } from "./pet-dialog";

function MakePetAction({ row }: { row: CreatureRow }) {
  const [open, setOpen] = useState(false);
  if (row.kind !== "monster") return null;
  return (
    <>
      <Tooltip content="Make pet…">
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="ent-pet-make"
          data-record-id={row.id}
          aria-label={`Make pet from ${row.name}`}
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
