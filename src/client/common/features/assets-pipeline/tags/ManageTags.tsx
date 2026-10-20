// Manage tags (FR-ASSET-43, -47, ASSET §7 row 2): a ghost icon Button opening a DropdownMenu with
// each tag of the chip row: Rename… (DM tags only; naming an existing tag asks "Merge ‹a› into
// ‹b›? ‹n› images") and Delete… ("Remove ‹tag› from ‹n› images?"). `n` counts listed images
// (attachments change too). Disabled with "Reconnecting…" while not live; a reject shows inline.
import {
  deletePrompt,
  renamePrompt,
  type TagChip,
  type TagChips,
} from "@shared/assets-pipeline/search";
import { ASSET_INTENTS, ImageTag } from "@shared/assets-pipeline/tags";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { PencilIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, Fragment, useState } from "react";
import { RECONNECTING, useTagIntent } from "./intent";
import { Live } from "./TagEditor";

type Editing = { kind: "rename"; chip: TagChip } | { kind: "delete"; chip: TagChip };

export function ManageTags({ chips, live }: { chips: TagChips; live: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  return (
    <>
      <DropdownMenu>
        <Live why={live ? null : RECONNECTING}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label="Manage tags"
              data-testid="asset-tags-manage"
              disabled={!live}
            >
              <TagsIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Live>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          {chips.tags.length === 0 && <DropdownMenuItem disabled>No tags yet</DropdownMenuItem>}
          {chips.tags.map((chip, i) => (
            <Fragment key={chip.key}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {chip.label} ({chip.count})
              </DropdownMenuLabel>
              {!chip.builtIn && (
                <DropdownMenuItem
                  data-testid="asset-tags-rename"
                  data-tag={chip.key}
                  onSelect={() => setEditing({ kind: "rename", chip })}
                >
                  <PencilIcon /> Rename…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                data-testid="asset-tags-delete"
                data-tag={chip.key}
                onSelect={() => setEditing({ kind: "delete", chip })}
              >
                <Trash2Icon /> Delete…
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-testid="asset-tags-dialog" aria-describedby={undefined}>
          {editing && (
            <TagChange editing={editing} chips={chips} live={live} close={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TagChange({
  editing,
  chips,
  live,
  close,
}: {
  editing: Editing;
  chips: TagChips;
  live: boolean;
  close(): void;
}) {
  const { chip } = editing;
  const { busy, error, setError, send } = useTagIntent();
  const [to, setTo] = useState(chip.label);
  const merge = editing.kind === "rename" ? renamePrompt(chips, chip, to) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (editing.kind === "delete") {
      if (await send(ASSET_INTENTS.deleteTag, { tag: chip.label })) close();
      return;
    }
    const parsed = ImageTag.safeParse(to);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid tag");
      return;
    }
    if (parsed.data === chip.label) return close();
    if (await send(ASSET_INTENTS.renameTag, { from: chip.label, to: parsed.data })) close();
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>
          {editing.kind === "rename" ? `Rename ${chip.label}` : "Delete tag"}
        </DialogTitle>
        {editing.kind === "delete" && (
          <DialogDescription data-testid="asset-tags-prompt">
            {deletePrompt(chip)}
          </DialogDescription>
        )}
      </DialogHeader>
      {editing.kind === "rename" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="asset-tags-rename-to">New name</Label>
          <Input
            id="asset-tags-rename-to"
            data-testid="asset-tags-rename-to"
            value={to}
            autoFocus
            onChange={(e) => {
              setTo(e.target.value);
              setError(null);
            }}
          />
          {merge && (
            <p data-testid="asset-tags-prompt" className="text-sm text-muted-foreground">
              {merge}
            </p>
          )}
        </div>
      )}
      {error && (
        <p data-testid="asset-tags-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="asset-tags-confirm"
          variant={editing.kind === "delete" ? "destructive" : "default"}
          disabled={!live || busy}
        >
          {editing.kind === "delete" ? "Delete" : merge ? "Merge" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}
