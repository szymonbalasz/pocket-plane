// DM entry actions (CMP §7; FR-CMP-24/25/27): monster entries **Derive…**; other kinds **Clone**
// (homebrew form prefilled, independent copy); homebrew also **Edit** and **Delete** (confirm;
// sheet rows added from it stay). Item entries also **Add to party** (FR-CMP-40). Toolbar **New**
// opens a blank homebrew form. Writes are disabled while not live (shell offline rule); the window
// refetches after each.
import type { EntryResponse } from "@shared/compendium/rest";
import { isReadOnlyEntry } from "@shared/compendium/schemas";
import { type Api, ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { useLive } from "@ui/features/combat-tracker/store";
import { backToList } from "@ui/features/compendium/nav";
import { CopyIcon, CopyPlusIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { StatBlockTarget } from "../entities/statblock/logic";
import { OpenAtTable } from "../entities/statblock/openers";
import { AddToParty } from "./AddToParty";
import { hasAddToParty } from "./add-to-party";
import { DeriveDialog } from "./DeriveDialog";
import { HomebrewDialog } from "./HomebrewForm";
import type { FormMode } from "./homebrew-form";
import { deleteEntry } from "./homebrew-rest";

function ConfirmDelete({
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid="cmp-delete-dialog">
        <DialogTitle>Delete {name}?</DialogTitle>
        <DialogDescription>Sheet rows already added from it stay.</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="cmp-delete-confirm"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const iconButton = "h-7 px-2 text-xs";

export function EntryActions({
  api,
  data,
  openAtTable,
}: {
  api: Api;
  data: EntryResponse;
  /** FR-KIT-101 (K7): opens the stat block window (the DM window passes `useOpenStatBlock`). */
  openAtTable?: (target: StatBlockTarget) => void;
}) {
  const live = useLive();
  const [mode, setMode] = useState<FormMode | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const e = data.entry;

  if (e.kind === "monster") {
    if (!data.definition) return null;
    return (
      <>
        {/* FR-KIT-101 (K7): the rollable stat block window on this monster. */}
        {openAtTable && (
          <OpenAtTable definitionId={data.definition.id} entryId={e.id} open={openAtTable} />
        )}
        <Button
          variant="outline"
          size="sm"
          className={iconButton}
          data-testid="cmp-derive"
          disabled={!live}
          onClick={() => setDeriving(true)}
        >
          <CopyPlusIcon className="size-3.5" /> Derive…
        </Button>
        <DeriveDialog api={api} data={data} open={deriving} onClose={() => setDeriving(false)} />
      </>
    );
  }

  const homebrew = !isReadOnlyEntry(e);
  const remove = async () => {
    try {
      await deleteEntry(api, e.id);
      toast.success(`Deleted ${e.name}`);
      backToList();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    }
  };
  return (
    <>
      <Tooltip content="Clone to homebrew">
        <Button
          variant="outline"
          size="sm"
          className={iconButton}
          data-testid="cmp-clone"
          disabled={!live}
          onClick={() => setMode({ kind: "clone", base: e })}
        >
          <CopyIcon className="size-3.5" /> Clone
        </Button>
      </Tooltip>
      {homebrew && (
        <>
          <Button
            variant="outline"
            size="sm"
            className={iconButton}
            data-testid="cmp-edit"
            disabled={!live}
            onClick={() => setMode({ kind: "edit", entry: e })}
          >
            <PencilIcon className="size-3.5" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={iconButton}
            data-testid="cmp-delete"
            aria-label={`Delete ${e.name}`}
            disabled={!live}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
          <ConfirmDelete
            name={e.name}
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={() => void remove()}
          />
        </>
      )}
      {hasAddToParty(e) && <AddToParty entry={e} />}
      <HomebrewDialog api={api} mode={mode} onClose={() => setMode(null)} />
    </>
  );
}

/** Toolbar **New**: a blank homebrew form (kind chosen in the form). */
export function NewHomebrew({ api }: { api: Api }) {
  const live = useLive();
  const [mode, setMode] = useState<FormMode | null>(null);
  return (
    <>
      <Tooltip content="New homebrew">
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2"
          data-testid="cmp-new"
          aria-label="New homebrew"
          disabled={!live}
          onClick={() => setMode({ kind: "new" })}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </Tooltip>
      <HomebrewDialog api={api} mode={mode} onClose={() => setMode(null)} />
    </>
  );
}
