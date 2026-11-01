// Rename / delete the selected image (FR-ASSET-66, #386): two ghost icon Buttons beside its name
// in the picker's tag row. Rename… → Dialog with the name → `assets.rename`; Delete… → "Delete
// ‹name›? …" → `assets.delete`. A reject shows inline in the Dialog (in use: the server names the
// uses, FR-ASSET-64). Disabled with "Reconnecting…" while not live. *(#394)* The Assets window's
// Sounds rows use it too (`noun` "sound", FR-ASSET-70). BL-177 (sim-17 as03): Delete… asks
// `assets.uses` first, so something in use is refused with its "Used in" line and no confirm; the
// server's check stays, for a use added meanwhile or a check that failed.
import {
  ASSET_MANAGE_INTENTS,
  type AssetUse,
  type AssetUsesResult,
  USES_CHECKING,
  usedInText,
} from "@shared/assets-pipeline/manage";
import { AssetName } from "@shared/assets-pipeline/schemas";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { useSync } from "@ui/sync/store";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Tip } from "../../components/ui/tip";
import { RECONNECTING, useTagIntent } from "./tags/intent";
import { Live } from "./tags/TagEditor";

type Mode = "rename" | "delete";
type Noun = "image" | "sound";
/** What the buttons act on: an image's or a sound's record. */
type Named = { id: string; name: string };

/** FR-ASSET-66: the delete prompt. */
export const deleteImagePrompt = (name: string) =>
  `Delete ${name}? Its links stop working. This can't be undone.`;

export function ImageActions({
  asset,
  live,
  noun = "image",
}: {
  asset: Named;
  live: boolean;
  noun?: Noun;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const button = (m: Mode) => {
    const label = m === "rename" ? `Rename ${noun}` : `Delete ${noun}`;
    const Icon = m === "rename" ? PencilIcon : Trash2Icon;
    return (
      <Live why={live ? null : RECONNECTING}>
        <Tip content={label} off={!live}>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label={label}
            data-testid={`asset-${m}`}
            data-record-id={asset.id}
            disabled={!live}
            onClick={() => setMode(m)}
          >
            <Icon className="size-3.5" />
          </Button>
        </Tip>
      </Live>
    );
  };
  return (
    <>
      {button("rename")}
      {button("delete")}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent data-testid="asset-manage-dialog" aria-describedby={undefined}>
          {mode && (
            <ImageChange
              mode={mode}
              asset={asset}
              noun={noun}
              live={live}
              close={() => setMode(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type DeleteCheck =
  | { state: "checking" }
  | { state: "used"; uses: readonly AssetUse[] }
  | { state: "clear" };

/** BL-177: what Delete… shows once `assets.uses` answers. A failed check: the confirm, as before. */
export const deleteCheckOf = (uses: readonly AssetUse[] | null): DeleteCheck =>
  uses !== null && uses.length > 0 ? { state: "used", uses } : { state: "clear" };

/** BL-177: asked once per Delete…; `assetId` null (a rename) asks nothing. */
function useDeleteCheck(assetId: string | null): DeleteCheck {
  const connection = useSync((s) => s.connection);
  const [check, setCheck] = useState<DeleteCheck>({ state: "checking" });
  useEffect(() => {
    if (assetId === null) return;
    let on = true;
    connection
      .sendIntent(ASSET_MANAGE_INTENTS.uses, { assetId })
      .then((r) => on && setCheck(deleteCheckOf((r as AssetUsesResult).uses)))
      .catch(() => on && setCheck(deleteCheckOf(null)));
    return () => {
      on = false;
    };
  }, [connection, assetId]);
  return check;
}

/** BL-177: something in use, refused up front: its "Used in" line, Close, no Delete. */
export function DeleteRefused({
  name,
  noun,
  uses,
  close,
}: {
  name: string;
  noun: Noun;
  uses: readonly AssetUse[];
  close(): void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>{`Delete ${noun}`}</DialogTitle>
        <DialogDescription>{`${name} can't be deleted while it's in use.`}</DialogDescription>
      </DialogHeader>
      <p
        data-testid="asset-delete-used"
        role="alert"
        className="max-h-40 overflow-y-auto text-sm text-destructive"
      >
        {`${usedInText(uses)}. Change those first.`}
      </p>
      <DialogFooter>
        <Button type="button" data-testid="asset-manage-close" onClick={close}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}

function ImageChange({
  mode,
  asset,
  noun,
  live,
  close,
}: {
  mode: Mode;
  asset: Named;
  noun: Noun;
  live: boolean;
  close(): void;
}) {
  const { busy, error, setError, send } = useTagIntent();
  const [name, setName] = useState(asset.name);
  const check = useDeleteCheck(mode === "delete" ? asset.id : null);
  const checking = mode === "delete" && check.state === "checking";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // React events bubble through the portal: never submit a host form (New scene, MAP §7).
    e.stopPropagation();
    if (mode === "delete") {
      if (checking) return; // Enter before the answer: nothing to confirm yet.
      if (await send(ASSET_MANAGE_INTENTS.delete, { assetId: asset.id })) close();
      return;
    }
    const parsed = AssetName.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    if (parsed.data === asset.name) return close();
    if (await send(ASSET_MANAGE_INTENTS.rename, { assetId: asset.id, name: parsed.data })) close();
  };
  if (mode === "delete" && check.state === "used") {
    return <DeleteRefused name={asset.name} noun={noun} uses={check.uses} close={close} />;
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{mode === "rename" ? `Rename ${noun}` : `Delete ${noun}`}</DialogTitle>
        {checking && <DialogDescription>{USES_CHECKING}</DialogDescription>}
        {mode === "delete" && !checking && (
          <DialogDescription data-testid="asset-delete-prompt">
            {deleteImagePrompt(asset.name)}
          </DialogDescription>
        )}
      </DialogHeader>
      {mode === "rename" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="asset-rename-name">Name</Label>
          <Input
            id="asset-rename-name"
            data-testid="asset-rename-name"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </div>
      )}
      {error && (
        <p data-testid="asset-manage-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        {!checking && (
          <Button
            type="submit"
            data-testid="asset-manage-confirm"
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={!live || busy}
          >
            {mode === "delete" ? "Delete" : "Rename"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
