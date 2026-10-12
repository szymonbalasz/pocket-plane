// Controlled one-field name dialog (rename token / scene / folder, new folder). Errors inline.
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { useEffect, useState } from "react";
import type { z } from "zod";

export interface NameFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  label?: string;
  initial?: string;
  schema: z.ZodType<string>;
  /** `<testId>-name`, `<testId>-submit`, `<testId>-error`. */
  testId: string;
  submitLabel?: string;
  onSubmit(name: string): Promise<unknown>;
}

export function NameFormDialog(p: NameFormDialogProps) {
  const [value, setValue] = useState(p.initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p.open) {
      setValue(p.initial ?? "");
      setError(null);
    }
  }, [p.open, p.initial]);

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
      p.onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label htmlFor={`${p.testId}-name`}>{p.label ?? "Name"}</Label>
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
              {p.submitLabel ?? "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
