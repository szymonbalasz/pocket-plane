// "New character…" (FR-CHARX-08, -29, -30): name Dialog; the DM also picks the owner and
// whether to start as a draft. The new character opens in edit mode.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { CHARX_INTENTS, type CharCreateResult } from "@shared/character-sheet/sheet";
import { EntityName } from "@shared/entities/schemas";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { SELECT } from "./fields";
import { requestEdit } from "./selection";
import { toastIntentError } from "./sheet-context";

export function CreateCharacterDialog({
  open,
  onOpenChange,
  client,
  players,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  client: "dm" | "player";
  players: readonly PlayerRecord[];
}) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useId();
  useEffect(() => {
    if (open) {
      setName("");
      setOwner(players[0]?.id ?? "");
      setDraft(false);
      setError(null);
    }
  }, [open, players]);
  const isDm = client === "dm";
  const submit = () => {
    const p = EntityName.safeParse(name);
    if (!p.success) return setError(p.error.issues[0]?.message ?? "Invalid name");
    if (isDm && !owner) return setError("Pick an owner");
    setBusy(true);
    connection
      .sendIntent(
        CHARX_INTENTS.create,
        isDm ? { name: p.data, ownerPlayerId: owner, draft } : { name: p.data },
      )
      .then((r) => {
        requestEdit((r as CharCreateResult).characterId);
        onOpenChange(false);
      })
      .catch(toastIntentError)
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New character</DialogTitle>
          <DialogDescription>
            {isDm
              ? "Create a character for a player."
              : "Your DM approves the sheet once it is filled in."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <Input
              id={`${uid}-name`}
              data-testid="charx-create-name"
              value={name}
              maxLength={60}
              autoFocus
              aria-invalid={error !== null}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </div>
          {isDm && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${uid}-owner`}>Owner</Label>
                <select
                  id={`${uid}-owner`}
                  data-testid="charx-create-owner"
                  className={SELECT}
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  {players.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${uid}-draft`}
                  data-testid="charx-create-draft"
                  checked={draft}
                  onCheckedChange={(v) => setDraft(v === true)}
                />
                <Label htmlFor={`${uid}-draft`}>Start as draft</Label>
              </div>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" data-testid="charx-create-submit" disabled={!live || busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
