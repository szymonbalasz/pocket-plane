// View of kind `test` (FR-NOTE-22): generic row; the button sends `note.resolve`.
import { TEST_KIND } from "@shared/notifications/schemas";
import { FlaskConicalIcon } from "lucide-react";
import { defineNotificationView } from "./views";

export const testNotificationView = defineNotificationView({
  kind: TEST_KIND,
  icon: FlaskConicalIcon,
  genericResolve: true,
});
