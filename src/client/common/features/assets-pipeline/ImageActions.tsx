// Rename / delete the selected image (FR-ASSET-66, #386): two ghost icon Buttons beside its name
// in the picker's tag row. Rename… → Dialog with the name → `assets.rename`; Delete… → "Delete
// ‹name›? …" → `assets.delete`. A reject shows inline in the Dialog (in use: the server names the
// uses, FR-ASSET-64). Disabled with "Reconnecting…" while not live.
import { ASSET_MANAGE_INTENTS } from "@shared/assets-pipeline/manage";
import { AssetName, type AssetRecord } from "@shared/assets-pipeline/schemas";
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
import { PencilIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Tip } from "../../components/ui/tip";
import { RECONNECTING, useTagIntent } from "./tags/intent";
import { Live } from "./tags/TagEditor";

type Mode = "rename" | "delete";

/** FR-ASSET-66: the delete prompt. */
export const deleteImagePrompt = (name: string) =>
  `Delete ${name}? Its links stop working. This can't be undone.`;

export function ImageActions({ asset, live }: { asset: AssetRecord; live: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const button = (m: Mode) => {
    const label = m === "rename" ? "Rename image" : "Delete image";
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
            <ImageChange mode={mode} asset={asset} live={live} close={() => setMode(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImageChange({
  mode,
  asset,
  live,
  close,
}: {
  mode: Mode;
  asset: AssetRecord;
  live: boolean;
  close(): void;
}) {
  const { busy, error, setError, send } = useTagIntent();
  const [name, setName] = useState(asset.name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // React events bubble through the portal: never submit a host form (New scene, MAP §7).
    e.stopPropagation();
    if (mode === "delete") {
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
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{mode === "rename" ? "Rename image" : "Delete image"}</DialogTitle>
        {mode === "delete" && (
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
        <Button
          type="submit"
          data-testid="asset-manage-confirm"
          variant={mode === "delete" ? "destructive" : "default"}
          disabled={!live || busy}
        >
          {mode === "delete" ? "Delete" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}
