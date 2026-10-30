// The import panel's confirm AlertDialog (FR-CMP-20, FR-CMPX-17) and its date format.
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@ui/components/ui/overlays";

/** "16 Oct 2026". */
export const importedDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ConfirmImport({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  action,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid="cmp-import-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="cmp-import-confirm"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
