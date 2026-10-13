// Alert Toasts go to the client's one Toaster (ShellToaster), in its toast region (FR-SHELL-01).
import { toast } from "sonner";
import { alertText, type ShellAlert } from "./alerts";

/** Toast "‹title› — ‹detail›" (FR-SHELL-22); a repeat of the same id replaces its toast. */
export function showAlertToast(a: ShellAlert): void {
  toast(alertText(a), {
    id: `alert:${a.id}`,
    testId: "ui-alert-toast",
  });
}
