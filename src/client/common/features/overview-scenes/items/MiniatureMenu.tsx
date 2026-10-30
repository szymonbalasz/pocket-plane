// A miniature's menu parts (FR-OVW-32–34): the Shape and Owner submenus, as a token's (FR-MAP-18, -35),
// and the Name dialog. Each sends one `ovw.updateItems`; the server decides.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import {
  MINIATURE_NAME_MAX,
  MiniatureName,
  type MiniatureShape,
} from "@shared/overview-scenes/schemas";
import { ShapesIcon, UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/overlays";
import { Input, Label } from "../../../components/ui/primitives";
import { useRecords } from "../../../sync/store";
import { toastReject } from "../../scenes-map/intents";
import { updateMiniature } from "../miniature-actions";
import { useOverviewEditor } from "../overview-editor";
import type { ItemMenuSubProps, ItemSend } from "./item-kind";

const NOBODY = "__none__";

const SHAPES: { value: MiniatureShape; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "none", label: "None" },
];

export function ShapeSub({ item, send }: ItemMenuSubProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="ovw-item-menu-shape">
        <ShapesIcon /> Shape
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={item.shape ?? "round"}
          onValueChange={(v) => {
            updateMiniature(send, item, { shape: v }).catch(toastReject);
          }}
        >
          {SHAPES.map((sh) => (
            <DropdownMenuRadioItem
              key={sh.value}
              value={sh.value}
              data-testid="ovw-item-shape-option"
              data-value={sh.value}
            >
              {sh.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** FR-OVW-33: off on a linked miniature: its owner is the character's. */
export function OwnerSub({ item, send }: ItemMenuSubProps) {
  const players = useRecords<PlayerRecord>("player");
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-testid="ovw-item-menu-owner"
        disabled={item.characterId !== null}
      >
        <UserIcon /> Owner
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={item.ownerPlayerId ?? NOBODY}
          onValueChange={(v) => {
            updateMiniature(send, item, { ownerPlayerId: v === NOBODY ? null : v }).catch(
              toastReject,
            );
          }}
        >
          <DropdownMenuRadioItem
            value={NOBODY}
            data-testid="ovw-item-owner-option"
            data-record-id=""
          >
            None
          </DropdownMenuRadioItem>
          {players.map((p) => (
            <DropdownMenuRadioItem
              key={p.id}
              value={p.id}
              data-testid="ovw-item-owner-option"
              data-record-id={p.id}
            >
              {p.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** FR-OVW-32: 0–40 characters; an empty name is no name. Errors inline. */
export function MiniatureNameDialog({ send }: { send: ItemSend }) {
  const item = useOverviewEditor((s) =>
    s.naming ? (s.items.find((i) => i.id === s.naming) ?? null) : null,
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initial = item?.text ?? "";
  const open = item !== null;
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);
  const close = () => useOverviewEditor.setState({ naming: null });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const parsed = MiniatureName.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    updateMiniature(send, item, { text: parsed.data }).then(close, (err) =>
      setError(err instanceof Error ? err.message : "Something went wrong"),
    );
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent aria-describedby={undefined} data-testid="ovw-miniature-name-dialog">
        <DialogHeader>
          <DialogTitle>Name</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label htmlFor="ovw-miniature-name-input">Name</Label>
          <Input
            id="ovw-miniature-name-input"
            data-testid="ovw-miniature-name-input"
            maxLength={MINIATURE_NAME_MAX}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="ovw-miniature-name-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button data-testid="ovw-miniature-name-submit" type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
