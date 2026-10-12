// Kind `test` (FR-NOTE-22): created only by the test-mode intent `note.testSend`.
import { TEST_KIND } from "@shared/notifications/schemas";
import { z } from "zod";
import { defineNotificationKind } from "./kind";

export const testKind = defineNotificationKind({
  kind: TEST_KIND,
  ownerSpec: "notifications",
  payload: z.object({}).strict(),
  genericResolve: true,
});
