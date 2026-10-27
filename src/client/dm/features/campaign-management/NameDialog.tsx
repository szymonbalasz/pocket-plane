// Dialog with one validated name field (create / rename). Inline validation, server errors inline too.
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { useState } from "react";
import type { z } from "zod";

interface Props {
  title: string;
  label: string;
  initial?: string;
  schema: z.ZodType<string>;
  /** Test-id prefix: `<prefix>` trigger, `<prefix>-name`, `<prefix>-submit`, `<prefix>-error`. */
  testId: string;
  /** Omitted: the caller opens it (`open` / `onOpenChange`, e.g. a menu item, FR-KIT-11). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  submitLabel: string;
  onSubmit(name: string): Promise<void>;
  disabled?: boolean;
}

export function NameDialog(p: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = p.open ?? ownOpen;
  const setOpen = (o: boolean) => (p.open === undefined ? setOwnOpen(o) : p.onOpenChange?.(o));
  const [value, setValue] = useState(p.initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each opening starts from the initial name, however it was opened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(p.initial ?? "");
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = p.schema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setBusy(true);
    try {
      await p.onSubmit(parsed.data);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {p.trigger && (
        <DialogTrigger asChild disabled={p.disabled} data-testid={p.testId}>
          {p.trigger}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label htmlFor={`${p.testId}-name`}>{p.label}</Label>
          <Input
            id={`${p.testId}-name`}
            data-testid={`${p.testId}-name`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" data-testid={`${p.testId}-error`}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button data-testid={`${p.testId}-submit`} type="submit" disabled={busy}>
              {p.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
